"""Stage5c — 裂变层补充：为没有进入 Top-20 完整脚本（pipeline/scripts.py）的
decide.py 轻量 creative_variants 生成真实英文译文，供前端英文界面使用。

范围：cache/decisions/*.json 里有 creative_variants，但 cache/scripts/ 里
没有对应 4 个完整脚本文件的达人（即 build.py 里 scripts=None、前端会降级渲染
creative_variants 的那一批）。已有完整双语脚本的 Top-20 不在本阶段处理范围内。

这是翻译，不是重新分析：prompt 要求 DeepSeek 对给定的中文 creative_variants
原文做忠实英文翻译，保留原意、结构、变体数量，不允许引入原文没有的新论据或
数字——避免"翻译"变成用同一个模型重新编一份内容。

Run:
    python -m pipeline.translate_variants --limit 3   # 验证：只跑前3个
    python -m pipeline.translate_variants              # 全量（断点续跑）
"""
import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

from pipeline.common.http import post_json
from pipeline.common.logging import get_logger
from pipeline.common.variants import normalize_variant

logger = get_logger("translate_variants")

ROOT = Path(__file__).resolve().parent
DECISIONS_CACHE_DIR = ROOT / "cache" / "decisions"
SCRIPTS_CACHE_DIR = ROOT / "cache" / "scripts"
TRANSLATIONS_CACHE_DIR = ROOT / "cache" / "variant_translations"
FAILURES_PATH = ROOT / "artifacts" / "translate_variants_failures.json"

MODEL_NAME = "deepseek-v4-flash"
BASE_URL = "https://api.deepseek.com"
MAX_RETRIES = 3
CONCURRENCY = 3

REQUIRED_VARIANT_FIELDS = [
    "variant_name", "script_direction", "subtitle_highlights",
    "target_platform_note", "target_market",
]


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def has_full_scripts(channel_id: str, product_id: str) -> bool:
    """Mirrors build.py's load_scripts_for gating: >=4 cached files means the
    Top-20 full-script stage already covered this (channel, product) pair, so
    it has real bilingual scripts and doesn't need a variant translation."""
    if not SCRIPTS_CACHE_DIR.exists():
        return False
    matches = list(SCRIPTS_CACHE_DIR.glob(f"{channel_id}_{product_id}_*.json"))
    return len(matches) >= 4


def load_targets(limit: int | None) -> list[dict]:
    targets = []
    for p in sorted(DECISIONS_CACHE_DIR.glob("*.json")):
        channel_id = p.stem
        decision = _load_json(p)
        variants = [normalize_variant(v) for v in (decision.get("creative_variants") or [])]
        if not variants:
            continue
        if has_full_scripts(channel_id, decision["recommended_product"]):
            continue
        targets.append({"channel_id": channel_id, "variants": variants})
    if limit:
        targets = targets[:limit]
    return targets


def build_prompt(variants: list[dict]) -> list[dict]:
    system = (
        "你是专业的中英文本地化译者，服务于一份Insta360达人营销内部资料。"
        "你的任务只是把给定的中文JSON数组忠实翻译成英文，不改变原意、不增删信息、"
        "不重新分析或润色论据，数字与专有名词（人名、产品名、平台名）保持原样。"
        "源数据里个别条目可能缺少某个字段（上游生成时的已知缺口）——译文必须逐条"
        "保留和原文完全相同的字段集合，缺的字段翻译后依然缺，绝不可以为了凑齐"
        "字段而编造原文没有的内容。请以JSON格式输出，严格保留输入数组的字段结构"
        "（含每条目具体缺了哪个字段）与条目顺序和数量，不要输出JSON之外的任何文字。"
    )
    user = f"""请把下面这个 creative_variants 数组逐条译成英文，字段含义：
- variant_name：变体名称
- script_direction：具体分镜/叙事方向
- subtitle_highlights：字幕关键句/卖点话术（字符串数组）
- target_platform_note：该变体适配的平台/受众特点
- target_market：适用本地市场

原文（中文）：
{json.dumps(variants, ensure_ascii=False, indent=2)}

输出如下JSON结构，数组长度必须与原文完全一致，逐条对应，每条目的字段集合必须
与对应原文条目完全一致（原文有的字段译文必须有，原文没有的字段译文也不能有）：
{{
  "creative_variants_en": [
    {{
      "variant_name": "...",
      "script_direction": "...",
      "subtitle_highlights": ["...", "..."],
      "target_platform_note": "...",
      "target_market": "..."
    }}
  ]
}}
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def call_deepseek(api_key: str, messages: list[dict], source_variants: list[dict]) -> dict:
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
            variants_en = data.get("creative_variants_en")
            if not isinstance(variants_en, list) or len(variants_en) != len(source_variants):
                raise ValueError(
                    f"expected {len(source_variants)} translated variants, got "
                    f"{len(variants_en) if isinstance(variants_en, list) else variants_en!r}"
                )
            for src, v in zip(source_variants, variants_en):
                expected_fields = {f for f in REQUIRED_VARIANT_FIELDS if f in src}
                got_fields = {f for f in REQUIRED_VARIANT_FIELDS if f in v}
                if got_fields != expected_fields:
                    raise ValueError(
                        f"field set mismatch vs source: expected {sorted(expected_fields)}, "
                        f"got {sorted(got_fields)}"
                    )
            return data
        except Exception as exc:
            last_exc = exc
            logger.warning("DeepSeek call failed (attempt %d/%d): %s", attempt, MAX_RETRIES, exc)
    raise last_exc


def process_one(api_key: str, target: dict) -> str:
    channel_id = target["channel_id"]
    messages = build_prompt(target["variants"])
    llm_out = call_deepseek(api_key, messages, source_variants=target["variants"])

    TRANSLATIONS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = TRANSLATIONS_CACHE_DIR / f"{channel_id}.json"
    payload = {"creative_variants_en": llm_out["creative_variants_en"], "model": MODEL_NAME}
    cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return channel_id


def run(limit: int | None):
    load_dotenv(ROOT.parent / ".env")
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY not set in .env")

    targets = load_targets(limit)
    logger.info("%d decisions need creative_variants translation (limit=%s)", len(targets), limit)

    todo = []
    for t in targets:
        if (TRANSLATIONS_CACHE_DIR / f"{t['channel_id']}.json").exists():
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
