"""Stage5d — 视觉理解 + 决策卡自由文本英译，供前端英文界面使用。

范围：cache/vision/*.json 与 cache/decisions/*.json 里除固定词表字段（camera_perspective/
narrative_pace 等已用前端字典翻译）外的自由文本——vision.sport_types/evidence、
decision.reasoning/localization_notes/risk_review.conclusion/price_range.basis。
这些是每个达人独有的 LLM 生成内容（sport_types 232 个不同值，不是固定词表，
不能像 vertical/perspective/pace 那样查字典），只能真翻译。

vision 与 decisions 缓存目前是同一批 351 个 channel_id（已核实完全重合），
所以每个 channel 一次 DeepSeek 调用即可，不必分开跑两个阶段。

这是翻译，不是重新分析：要求 DeepSeek 对给定中文原文做忠实英文翻译，保留原意、
保留维度名/数字/百分比（如 stabilization_demand=1.0、$15/千订阅 这类不翻译),
不允许引入原文没有的新论据。

Run:
    python -m pipeline.translate_content --limit 3   # 验证：只跑前3个
    python -m pipeline.translate_content              # 全量（断点续跑）
"""
import argparse
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

from pipeline.common.http import post_json
from pipeline.common.logging import get_logger

logger = get_logger("translate_content")

ROOT = Path(__file__).resolve().parent
VISION_CACHE_DIR = ROOT / "cache" / "vision"
DECISIONS_CACHE_DIR = ROOT / "cache" / "decisions"
CONTENT_TRANSLATIONS_CACHE_DIR = ROOT / "cache" / "content_translations"
FAILURES_PATH = ROOT / "artifacts" / "translate_content_failures.json"

MODEL_NAME = "deepseek-v4-flash"
BASE_URL = "https://api.deepseek.com"
MAX_RETRIES = 3
CONCURRENCY = 3

REQUIRED_FIELDS = [
    "sport_types_en", "evidence_en", "reasoning_en",
    "localization_notes_en", "risk_review_conclusion_en", "price_range_basis_en",
]

CJK_RE = re.compile(r"[一-鿿]")


def _leftover_chinese(data: dict) -> list[str]:
    """Guards against the model translating the surrounding sentence but
    leaving an embedded reference untranslated (e.g. '视频4' or
    'narrative_pace=快节奏') — a real failure mode seen during validation,
    not a hypothetical. Any Chinese character in an *_en field is a bug,
    not an acceptable partial translation, so this fails the whole call."""
    offenders = []
    for field in ["evidence_en", "reasoning_en", "localization_notes_en", "risk_review_conclusion_en", "price_range_basis_en"]:
        if CJK_RE.search(data.get(field, "")):
            offenders.append(field)
    for i, s in enumerate(data.get("sport_types_en") or []):
        if CJK_RE.search(s):
            offenders.append(f"sport_types_en[{i}]")
    return offenders


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_targets(limit: int | None) -> list[dict]:
    targets = []
    for p in sorted(DECISIONS_CACHE_DIR.glob("*.json")):
        channel_id = p.stem
        vision_path = VISION_CACHE_DIR / f"{channel_id}.json"
        if not vision_path.exists():
            # Shouldn't happen (vision/decisions caches are the same 351-channel
            # set as of this stage's design), but don't fabricate a translation
            # for content that isn't there.
            logger.warning("skip %s: no vision cache", channel_id)
            continue
        decision = _load_json(p)
        vision = _load_json(vision_path)
        targets.append({
            "channel_id": channel_id,
            "sport_types": vision.get("sport_types") or [],
            "evidence": vision.get("evidence") or "",
            "reasoning": decision.get("reasoning") or "",
            "localization_notes": decision.get("localization_notes") or "",
            "risk_review_conclusion": (decision.get("risk_review") or {}).get("conclusion") or "",
            "price_range_basis": (decision.get("price_range") or {}).get("basis") or "",
        })
    if limit:
        targets = targets[:limit]
    return targets


def build_prompt(target: dict) -> list[dict]:
    system = (
        "你是专业的中英文本地化译者，服务于一份Insta360达人营销内部资料。"
        "你的任务只是把给定的中文字段**完整**翻译成英文，不改变原意、不增删信息、"
        "不重新分析或润色论据，也**绝对不允许**留下任何未翻译的中文/日文/其他CJK字符——"
        "包括'视频4'这类引用要译成'Video 4'，'narrative_pace=快节奏'这类维度取值引用里"
        "的中文值也要译成对应英文（如 fast-paced）。特别注意：原文里如果举了具体的中文"
        "或日文标签/关键词/地名作为本地化建议的例子（比如建议某市场加'自転車'标签、"
        "建议提及'台湾'、建议用'跑步'做关键词），这些例子本身也必须翻译成英文"
        "（分别译成'bicycle'、'Taiwan'、'running'这样的英文对应词），不能因为它是"
        "'举例说明用某语言的标签'就保留原文字符——输出里不能出现一个CJK字符，没有例外。"
        "只有下面这几类保持原样：英文变量名本身（如 stabilization_demand、"
        "perspective_ratio）、具体数字、百分比、金额、产品名（Insta360 X5等）、"
        "竞品名（GoPro/DJI等）。请以JSON格式输出，不要输出JSON之外的任何文字。"
    )
    user = f"""请把下面这些字段逐条译成英文，字段含义：
- sport_types：运动类型标签数组
- evidence：视觉理解证据段落（引用视频编号如"视频4"要译成"Video 4"；维度变量名与数值中，
  变量名和数字保持不变，但变量取值如果是中文词（如 narrative_pace=快节奏）要把中文词也
  译成英文，不能有残留中文）
- reasoning：决策推荐理由段落
- localization_notes：本地化建议段落
- risk_review_conclusion：竞品风险评估结论段落
- price_range_basis：报价依据说明（含公式和数字，数字/公式不译，只译中文说明文字）

原文（中文）：
{json.dumps({
        "sport_types": target["sport_types"],
        "evidence": target["evidence"],
        "reasoning": target["reasoning"],
        "localization_notes": target["localization_notes"],
        "risk_review_conclusion": target["risk_review_conclusion"],
        "price_range_basis": target["price_range_basis"],
    }, ensure_ascii=False, indent=2)}

输出如下JSON结构，sport_types_en 数组长度必须与原文 sport_types 完全一致、逐条对应：
{{
  "sport_types_en": ["...", "..."],
  "evidence_en": "...",
  "reasoning_en": "...",
  "localization_notes_en": "...",
  "risk_review_conclusion_en": "...",
  "price_range_basis_en": "..."
}}
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def call_deepseek(api_key: str, target: dict) -> dict:
    messages = build_prompt(target)
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = post_json(
                f"{BASE_URL}/chat/completions",
                json={"model": MODEL_NAME, "messages": messages, "response_format": {"type": "json_object"}},
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=(10, 60),
            )
            content = resp["choices"][0]["message"]["content"]
            data = json.loads(content)
            missing = [f for f in REQUIRED_FIELDS if f not in data]
            if missing:
                raise ValueError(f"translated content missing fields: {missing}")
            if not isinstance(data["sport_types_en"], list) or len(data["sport_types_en"]) != len(target["sport_types"]):
                raise ValueError(
                    f"expected {len(target['sport_types'])} sport_types_en entries, "
                    f"got {data['sport_types_en']!r}"
                )
            offenders = _leftover_chinese(data)
            if offenders:
                raise ValueError(f"leftover Chinese characters in translated fields: {offenders}")
            return data
        except Exception as exc:
            last_exc = exc
            logger.warning("DeepSeek call failed (attempt %d/%d): %s", attempt, MAX_RETRIES, exc)
    raise last_exc


def process_one(api_key: str, target: dict) -> str:
    channel_id = target["channel_id"]
    data = call_deepseek(api_key, target)

    CONTENT_TRANSLATIONS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CONTENT_TRANSLATIONS_CACHE_DIR / f"{channel_id}.json"
    payload = {**data, "model": MODEL_NAME}
    cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return channel_id


def run(limit: int | None):
    load_dotenv(ROOT.parent / ".env")
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY not set in .env")

    targets = load_targets(limit)
    logger.info("%d channels need vision+decision content translation (limit=%s)", len(targets), limit)

    todo = []
    for t in targets:
        if (CONTENT_TRANSLATIONS_CACHE_DIR / f"{t['channel_id']}.json").exists():
            continue
        todo.append(t)
    logger.info("%d already cached, %d to process this run", len(targets) - len(todo), len(todo))

    succeeded, failures = 0, []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(process_one, api_key, t): t for t in todo}
        for fut in as_completed(futures):
            t = futures[fut]
            try:
                cid = fut.result()
                succeeded += 1
                logger.info("[%d/%d] OK: %s", succeeded, len(todo), cid)
            except Exception as exc:
                failures.append({"channel_id": t["channel_id"], "error": str(exc)})
                logger.error("FAILED: %s: %s", t["channel_id"], exc)

    if failures:
        FAILURES_PATH.parent.mkdir(parents=True, exist_ok=True)
        existing = _load_json(FAILURES_PATH) if FAILURES_PATH.exists() else []
        FAILURES_PATH.write_text(json.dumps(existing + failures, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = {"targets": len(targets), "processed_this_run": len(todo), "succeeded": succeeded, "failed": len(failures)}
    logger.info("=== DONE === %s", summary)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="only process first N targets (validation)")
    args = parser.parse_args()
    print(json.dumps(run(args.limit), ensure_ascii=False, indent=2))
