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
tags (keywords come from the category's products.yaml); the LLM then reviews that rule's finding rather
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

from pipeline.common import config
from pipeline.common.http import post_json
from pipeline.common.logging import get_logger

logger = get_logger("decide")

ROOT = Path(__file__).resolve().parent

VISION_CACHE_ROOT = ROOT / "cache" / "vision"
DECISIONS_CACHE_ROOT = ROOT / "cache" / "decisions"
FAILURES_PATH = ROOT / "artifacts" / "decide_failures.json"

MODEL_NAME = "deepseek-v4-flash"
BASE_URL = "https://api.deepseek.com"
DEFAULT_TOP_K = 60
MAX_RETRIES = 3

# Rough, explicitly-heuristic pricing assumption — NOT a real rate card.
# Documented here and surfaced to the LLM/UI as an estimate, not fact.
USD_PER_1K_SUBS = 15
PRICE_RANGE_SPREAD = 0.3  # +/-30% around the point estimate

def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_products(category: str | None = None) -> list[dict]:
    return config.load_products(category)


def detect_competitor_mentions(channel: dict, category: str | None = None) -> dict:
    keywords = config.load_competitor_keywords(category)
    haystack_parts = [channel.get("title", ""), channel.get("description", "")]
    for v in channel["videos"]:
        haystack_parts.append(v.get("title", ""))
        haystack_parts.append(v.get("description", "") or "")
        haystack_parts.extend(v.get("tags", []) or [])
    haystack = " ".join(haystack_parts).lower()
    labels = config.load_competitor_labels(category)
    # Report the brand's English name, not the matched string. Matching keeps
    # the per-language variants (dropping 理肤泉 would miss Chinese channels
    # entirely), but the hit reaches both the UI and the Stage5 prompt, and both
    # are English-only.
    hits = sorted({labels.get(kw, kw) for kw in keywords if kw in haystack})
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
        # potential is an object ({value, value_lo, value_hi, rank_score}) since
        # the dual-head rework; this used to treat it as a bare number. The bug
        # stayed hidden because every action_camera card was already cached, so
        # this path had not run since.
        potential_value = potential.get("value")
        if not isinstance(potential_value, (int, float)):
            continue
        combined = math.sqrt(max(potential_value, 0) * max(best_resonance, 0))
        candidates.append({
            "channel_id": cid,
            "channel": channels_by_id[cid],
            "potential": potential_value,
            "resonance_by_product": resonance,
            "recommended_product_id": best_product_id,
            "recommended_resonance": best_resonance,
            "combined_score": combined,
        })
    candidates.sort(key=lambda c: -c["combined_score"])
    return candidates[:top_k]


def build_prompt(candidate: dict, product: dict, vision: dict, competitor_check: dict,
                 price_range: dict, category: str | None = None) -> list[dict]:
    """Prompt is English, and the brand/category framing comes from config.

    It used to open with a hardcoded Insta360 persona and ask for Chinese
    output. Both were wrong past the first category: a sunscreen brief would
    have been written in action-camera language, and every field then needed a
    separate DeepSeek translation pass before the (English-only) UI could show
    it. Generating English directly removes that pass — build-linkverse.mjs
    already falls back from reasoning_en to reasoning, so English output flows
    through untouched.
    """
    ch = candidate["channel"]
    dim_labels = config.load_feature_labels(category)
    system = (
        f"{config.load_decide_persona(category)} "
        "You are handed one YouTube creator's real data profile — channel facts, model scores, "
        "and vision-model evidence — and must return an actionable collaboration brief. "
        "Every claim must cite the specific numbers or evidence given to you; no generic filler. "
        "Write everything in English, including creator-facing copy, whatever language the "
        "channel itself uses. Respond with a single json object in exactly the requested shape, "
        "and nothing outside it."
    )
    raw_contributions = candidate["resonance_by_product"][candidate["recommended_product_id"]].get("feature_breakdown", {})
    # Feature keys are Chinese in config; send the English labels so they can be
    # quoted verbatim in the brief.
    contributions = {dim_labels.get(k, k): round(v, 1) for k, v in raw_contributions.items()}
    user = f"""
[CREATOR PROFILE]
Channel: {ch['title']}
Country/region: {ch.get('country') or 'unknown'}
Vertical: {config.load_vertical_labels(category).get(ch.get('vertical'), ch.get('vertical'))}
Subscribers: {ch.get('subscriber_count')}
Channel age (days): {ch.get('channel_age_days')}

[MODEL SCORES]
Potential P (0-100, higher = more likely to break out): {candidate['potential']:.1f}
Resonance R (0-100, fit with the recommended product): {candidate['recommended_resonance']:.1f}
Recommended product: {product['name']} ({product['description']})
Feature-level resonance contributions: {json.dumps(contributions, ensure_ascii=False)}

[VISION EVIDENCE] (from the model's analysis of this channel's recent thumbnails and titles)
Content types: {vision.get('sport_types_en') or vision.get('content_topics') or vision.get('sport_types')}
Camera perspective: {vision.get('camera_perspective')}
Narrative pace: {vision.get('narrative_pace')}
Evidence: {vision.get('evidence_en') or vision.get('evidence')}

[COMPETITOR RULE CHECK] (a keyword rule already scanned titles/description/tags — review its
finding, do not re-guess it)
Rule matched: {competitor_check['competitor_flag']}
Matched keywords: {competitor_check['flagged_keywords']}

[PRICE REFERENCE] (heuristic estimate, not a real rate card)
{price_range['basis']}
Estimated range: ${price_range['min']}-${price_range['max']}

Return this json structure:
{{
  "reasoning": "Why this creator, citing the specific scores/evidence/numbers above",
  "creative_variants": [
    {{
      "variant_name": "Name of the variant",
      "script_direction": "Concrete shot/narrative direction, grounded in this creator's actual style",
      "subtitle_highlights": ["Caption line / selling point 1", "..."],
      "target_platform_note": "Which platform/audience this variant suits",
      "target_market": "Local market it fits, based on the channel's country/region"
    }}
  ],
  "risk_review": {{
    "conclusion": "Your review of the rule's finding. If it matched, say how to handle the exclusivity risk"
  }},
  "localization_notes": "Localization advice for this channel's country/region and vertical"
}}
Give 2-3 creative_variants that differ substantively (different selling point, different audience
angle) — not restatements of each other.
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


def run(limit: int | None, top_k: int, category: str | None = None):
    load_dotenv(ROOT.parent / ".env")
    category = config.resolve(category)
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("DEEPSEEK_API_KEY not set in .env")

    features_data = _load_json(config.artifacts_dir(category) / 'features.json')
    scores_data = _load_json(config.artifacts_dir(category) / 'scores.json')
    products = load_products(category)
    products_by_id = {p["id"]: p for p in products}
    vision_cache_dir = VISION_CACHE_ROOT / category
    decisions_cache_dir = DECISIONS_CACHE_ROOT / category

    candidates = build_candidates(features_data, scores_data, products, top_k)
    logger.info("%d candidates ranked by sqrt(P*R) (top_k=%d, of which vision-analyzed candidates available)",
                len(candidates), top_k)

    if limit:
        candidates = candidates[:limit]

    decisions_cache_dir.mkdir(parents=True, exist_ok=True)
    succeeded, failures = 0, []
    for i, cand in enumerate(candidates, 1):
        cache_path = decisions_cache_dir / f"{cand['channel_id']}.json"
        if cache_path.exists():
            logger.info("[%d/%d] cached, skip: %s", i, len(candidates), cand["channel"]["title"])
            succeeded += 1
            continue

        vision_path = vision_cache_dir / f"{cand['channel_id']}.json"
        vision = _load_json(vision_path)
        product = products_by_id[cand["recommended_product_id"]]
        competitor_check = detect_competitor_mentions(cand["channel"], category)
        price_range = estimate_price_range(cand["channel"].get("subscriber_count"))

        try:
            messages = build_prompt(cand, product, vision, competitor_check, price_range, category)
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
    config.add_category_argument(parser)
    args = parser.parse_args()
    print(json.dumps(run(args.limit, args.top_k, args.category), ensure_ascii=False, indent=2))
