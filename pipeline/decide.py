"""Stage5 — 裂变层：DeepSeek 生成真实执行方案卡（含本地化创意变体）。

API confirmed from https://api-docs.deepseek.com/ on 2026-07-16 (not from
memory, per project rule):
  - model: deepseek-v4-flash (deepseek-chat/deepseek-reasoner deprecate on
    2026-07-24, so we use the current name, not the soon-to-be-retired one)
  - base_url: https://api.deepseek.com (OpenAI-compatible)
  - Bearer auth
  - response_format={"type": "json_object"} forces valid JSON — must mention
    "json" explicitly in the prompt or the docs say it can silently degrade

Candidates: channels that already have both a potential_score (Stage4) and a
resonance score (Stage4, gated on vision.py having analyzed them). Ranked by
geometric mean of potential and best-product resonance (both 0-100 scales,
so sqrt(P*R) stays 0-100 and requires BOTH to be high — an average would let
one weak axis hide behind a strong one).

Competitor exclusivity: a keyword rule runs FIRST against title/description/
tags (GoPro/DJI/Osmo/...); the LLM then reviews that rule's finding rather
than independently guessing, and the rule's raw hit is what the frontend
should redden, per the project's UI note.

Run:
    python -m pipeline.decide --limit 3     # validation run
    python -m pipeline.decide --top-k 60    # full run (cached, resumable)
"""
import argparse
import json
import math
import os
import re
from pathlib import Path

import yaml
from dotenv import load_dotenv

from pipeline.common.http import post_json
from pipeline.common.logging import get_logger

logger = get_logger("decide")

ROOT = Path(__file__).resolve().parent
FEATURES_PATH = ROOT / "artifacts" / "features.json"
SCORES_PATH = ROOT / "artifacts" / "scores.json"
VISION_CACHE_DIR = ROOT / "cache" / "vision"
PRODUCTS_PATH = ROOT / "config" / "products.yaml"
DECISIONS_CACHE_DIR = ROOT / "cache" / "decisions"
FAILURES_PATH = ROOT / "artifacts" / "decide_failures.json"

MODEL_NAME = "deepseek-v4-flash"
BASE_URL = "https://api.deepseek.com"
DEFAULT_TOP_K = 60
MAX_RETRIES = 3

# Rough, explicitly-heuristic pricing assumption — NOT a real rate card.
# Documented here and surfaced to the LLM/UI as an estimate, not fact.
USD_PER_1K_SUBS = 15
PRICE_RANGE_SPREAD = 0.3  # +/-30% around the point estimate

COMPETITOR_KEYWORDS = [
    "gopro", "go pro", "dji", "osmo", "akaso", "sjcam", "insta360 competitor",
    "ricoh theta", "kandao", "yi action", "campark", "dji osmo action",
]


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_products() -> list[dict]:
    with open(PRODUCTS_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)["products"]


def detect_competitor_mentions(channel: dict) -> dict:
    haystack_parts = [channel.get("title", ""), channel.get("description", "")]
    for v in channel["videos"]:
        haystack_parts.append(v.get("title", ""))
        haystack_parts.append(v.get("description", "") or "")
        haystack_parts.extend(v.get("tags", []) or [])
    haystack = " ".join(haystack_parts).lower()
    hits = sorted({kw for kw in COMPETITOR_KEYWORDS if kw in haystack})
    return {"competitor_flag": len(hits) > 0, "flagged_keywords": hits}


def estimate_price_range(subscriber_count: int | None) -> dict:
    if not subscriber_count:
        return {"min": None, "max": None, "currency": "USD", "basis": "subscriber_count unavailable (hidden by channel)"}
    point = (subscriber_count / 1000) * USD_PER_1K_SUBS
    return {
        "min": round(point * (1 - PRICE_RANGE_SPREAD)),
        "max": round(point * (1 + PRICE_RANGE_SPREAD)),
        "currency": "USD",
        "basis": f"启发式估算：${USD_PER_1K_SUBS}/千订阅 x 真实订阅数({subscriber_count})，±{int(PRICE_RANGE_SPREAD*100)}%，非真实报价",
    }


def build_candidates(features_data: dict, scores_data: dict, products: list[dict], top_k: int) -> list[dict]:
    channels_by_id = {c["channel_id"]: c for c in features_data["channels"]}
    candidates = []
    for cid, s in scores_data["scores"].items():
        potential = s.get("potential")
        resonance = s.get("resonance")
        if potential is None or resonance is None:
            continue  # not vision-analyzed yet, or no potential score
        best_product_id = max(resonance, key=lambda pid: resonance[pid]["value"])
        best_resonance = resonance[best_product_id]["value"]
        combined = math.sqrt(max(potential, 0) * max(best_resonance, 0))
        candidates.append({
            "channel_id": cid,
            "channel": channels_by_id[cid],
            "potential": potential,
            "resonance_by_product": resonance,
            "recommended_product_id": best_product_id,
            "recommended_resonance": best_resonance,
            "combined_score": combined,
        })
    candidates.sort(key=lambda c: -c["combined_score"])
    return candidates[:top_k]


def build_prompt(candidate: dict, product: dict, vision: dict, competitor_check: dict, price_range: dict) -> list[dict]:
    ch = candidate["channel"]
    feature_importance_top3 = None  # filled by caller if available
    system = (
        "你是Insta360全球达人营销团队的资深内容策略顾问。你会拿到一个YouTube创作者的"
        "真实数据档案（频道信息、算法打分、视觉理解证据），需要输出一份可执行的合作方案。"
        "所有结论都必须引用给你的具体数字和证据，禁止空泛套话。请以JSON格式输出，"
        "严格按照要求的字段结构，不要输出JSON之外的任何文字。"
    )
    contributions = candidate["resonance_by_product"][candidate["recommended_product_id"]].get("feature_breakdown", {})
    user = f"""
【创作者档案】
频道名：{ch['title']}
所在国家/地区：{ch.get('country') or '未知'}
垂类：{ch.get('vertical')}
订阅数：{ch.get('subscriber_count')}
频道年龄（天）：{ch.get('channel_age_days')}

【算法打分】
潜力分P（0-100，越高越可能起飞）：{candidate['potential']:.1f}
共振分R（0-100，与推荐单品的匹配度）：{candidate['recommended_resonance']:.1f}
推荐单品：{product['name']}（{product['description']}）
共振功能级贡献：{json.dumps(contributions, ensure_ascii=False)}

【视觉理解证据（AI分析该频道近期缩略图与标题得出）】
运动类型：{vision.get('sport_types')}
镜头视角：{vision.get('camera_perspective')}
叙事节奏：{vision.get('narrative_pace')}
判断依据：{vision.get('evidence')}

【规则引擎竞品检测】（已用关键词规则扫描标题/简介/标签，请复核而非重新猜测）
规则命中：{competitor_check['competitor_flag']}
命中关键词：{competitor_check['flagged_keywords']}

【报价参考】（启发式估算，非真实报价）
{price_range['basis']}
估算区间：${price_range['min']}-${price_range['max']}

请输出如下JSON结构：
{{
  "reasoning": "推荐理由，必须引用上面给出的具体分数/证据/数字",
  "creative_variants": [
    {{
      "variant_name": "变体名称",
      "script_direction": "具体分镜/叙事方向，须结合该创作者真实内容风格",
      "subtitle_highlights": ["字幕关键句/卖点话术1", "..."],
      "target_platform_note": "该变体适配的平台/受众特点",
      "target_market": "适用本地市场（结合频道所在国家/地区）"
    }}
  ],
  "risk_review": {{
    "conclusion": "结合规则命中结果给出复核结论，如规则命中为true必须说明如何处理竞品排他问题"
  }},
  "localization_notes": "结合频道所在国家/地区与垂类给出本地化建议"
}}
creative_variants 需要给出2-3个有实质差异的变体（例如强调不同卖点、不同受众切入角度），不要重复。
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def call_deepseek(api_key: str, messages: list[dict]) -> dict:
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = post_json(
                f"{BASE_URL}/chat/completions",
                json={
                    "model": MODEL_NAME,
                    "messages": messages,
                    "response_format": {"type": "json_object"},
                },
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=(10, 60),
            )
            content = resp["choices"][0]["message"]["content"]
            data = json.loads(content)
            for field in ["reasoning", "creative_variants", "risk_review", "localization_notes"]:
                if field not in data:
                    raise ValueError(f"missing field in DeepSeek output: {field}")
            if not isinstance(data["creative_variants"], list) or len(data["creative_variants"]) < 2:
                raise ValueError(f"creative_variants must have >=2 entries, got {data.get('creative_variants')!r}")
            return data
        except Exception as exc:
            last_exc = exc
            logger.warning("DeepSeek call failed (attempt %d/%d): %s", attempt, MAX_RETRIES, exc)
    raise last_exc


def run(limit: int | None, top_k: int):
    load_dotenv(ROOT.parent / ".env")
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY not set in .env")

    features_data = _load_json(FEATURES_PATH)
    scores_data = _load_json(SCORES_PATH)
    products = load_products()
    products_by_id = {p["id"]: p for p in products}

    candidates = build_candidates(features_data, scores_data, products, top_k)
    logger.info("%d candidates ranked by sqrt(P*R) (top_k=%d, of which vision-analyzed candidates available)",
                len(candidates), top_k)

    if limit:
        candidates = candidates[:limit]

    DECISIONS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    succeeded, failures = 0, []
    for i, cand in enumerate(candidates, 1):
        cache_path = DECISIONS_CACHE_DIR / f"{cand['channel_id']}.json"
        if cache_path.exists():
            logger.info("[%d/%d] cached, skip: %s", i, len(candidates), cand["channel"]["title"])
            succeeded += 1
            continue

        vision_path = VISION_CACHE_DIR / f"{cand['channel_id']}.json"
        vision = _load_json(vision_path)
        product = products_by_id[cand["recommended_product_id"]]
        competitor_check = detect_competitor_mentions(cand["channel"])
        price_range = estimate_price_range(cand["channel"].get("subscriber_count"))

        try:
            messages = build_prompt(cand, product, vision, competitor_check, price_range)
            llm_out = call_deepseek(api_key, messages)
            decision = {
                "recommended_product": cand["recommended_product_id"],
                "potential_score": cand["potential"],
                "resonance_score": cand["recommended_resonance"],
                "combined_score": cand["combined_score"],
                "reasoning": llm_out["reasoning"],
                "creative_variants": llm_out["creative_variants"],
                "price_range": price_range,
                "risk_review": {**competitor_check, "conclusion": llm_out["risk_review"]["conclusion"]},
                "localization_notes": llm_out["localization_notes"],
                "model": MODEL_NAME,
            }
            cache_path.write_text(json.dumps(decision, ensure_ascii=False, indent=2), encoding="utf-8")
            succeeded += 1
            logger.info("[%d/%d] OK: %s -> %s (P=%.1f R=%.1f)",
                        i, len(candidates), cand["channel"]["title"], product["name"],
                        cand["potential"], cand["recommended_resonance"])
        except Exception as exc:
            failures.append({"channel_id": cand["channel_id"], "title": cand["channel"]["title"], "error": str(exc)})
            logger.error("[%d/%d] FAILED: %s: %s", i, len(candidates), cand["channel"]["title"], exc)

    if failures:
        FAILURES_PATH.parent.mkdir(parents=True, exist_ok=True)
        existing = _load_json(FAILURES_PATH) if FAILURES_PATH.exists() else []
        FAILURES_PATH.write_text(json.dumps(existing + failures, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = {"candidates_considered": len(candidates), "succeeded": succeeded, "failed": len(failures)}
    logger.info("=== DONE === %s", summary)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="only process first N candidates (validation)")
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K, help="candidate pool size before --limit")
    args = parser.parse_args()
    print(json.dumps(run(args.limit, args.top_k), ensure_ascii=False, indent=2))
