"""Stage6 — merge every stage's output into data/dataset.json.

Single static file. No key ever goes into it (pipeline/.env stays
pipeline-only). Channels without vision/decision coverage yet get explicit
nulls, never fabricated values — the frontend is expected to render
"待分析"/"待接入" for those, per the project's honesty rule.

This is the full output; the frontend never fetches it directly. It is the
input to web/scripts/build-linkverse.mjs, which trims it down to
web/public/linkverse.json (English-only, decisions only) — that trimmed file
is the one the app actually loads.

Run:
    python -m pipeline.build
Reads pipeline/artifacts/{features,scores,quota_log}.json, pipeline/cache/{vision,decisions}/*.json,
pipeline/config/products.yaml. Writes data/dataset.json.
"""
import json
from pathlib import Path

from pipeline.common import config
from pipeline.common.logging import get_logger
from pipeline.common.variants import normalize_variant
from pipeline.score import SUBSCRIBER_TIERS, TOP_K_LIST

logger = get_logger("build")
SUBSCRIBER_TIER_NAMES = [t[0] for t in SUBSCRIBER_TIERS]

ROOT = Path(__file__).resolve().parent
# quota_log.json stays at the artifacts root: the YouTube daily budget is per
# API key, shared across categories, not per category.
QUOTA_LOG_PATH = ROOT / "artifacts" / "quota_log.json"
# Every per-channel cache is keyed by (category, channel): the same creator can
# be a candidate in more than one category, with a different content_vector,
# decision and script in each, because each category scores them in its own
# semantic space. <root>/<category>/<channel_id>.json.
CACHE_ROOT = ROOT / "cache"
# Deliberately NOT under web/public/: everything in that directory is copied
# verbatim into the deploy bundle, and this file is 60MB+ that no runtime code
# ever fetches (the frontend reads web/public/linkverse.json, the trimmed
# subset built from this one). Keeping it here makes it a build input, not a
# shipped asset.
DATA_ROOT = ROOT.parent / "data"


def dataset_out_path(category: str) -> Path:
    return DATA_ROOT / category / "dataset.json"

# Video-level fields kept in the output (drop internal-only ones like raw
# tags/description to keep dataset.json lean — the frontend doesn't need them).
VIDEO_FIELDS = [
    "video_id", "title", "published_at", "view_count", "like_count", "comment_count",
    "duration_seconds", "thumbnail_url", "age_days", "age_bucket",
    "relative_velocity", "season_adjusted_velocity",
]

# Country -> (market, language), derived from the real YouTube API `country`
# field (frequently null — the API doesn't require channels to set it). This
# is a coarse, honestly-labeled grouping for filtering/display only: it is
# NOT used to gate script generation (pipeline/scripts.py always produces
# both zh and en variants regardless of this field — see PLAN.md §8.1.1).
# Known country not in this table -> market "other", language "unknown"
# (we know the country but not the primary language). country=null -> both
# "unknown". Never guessed/fabricated beyond what the country code implies.
MARKET_LANGUAGE_BY_COUNTRY = {
    "US": ("north_america_europe", "en"), "CA": ("north_america_europe", "en"),
    "GB": ("north_america_europe", "en"), "AU": ("north_america_europe", "en"),
    "NZ": ("north_america_europe", "en"), "IE": ("north_america_europe", "en"),
    "DE": ("north_america_europe", "en"), "FR": ("north_america_europe", "en"),
    "ES": ("north_america_europe", "en"), "IT": ("north_america_europe", "en"),
    "NL": ("north_america_europe", "en"), "SE": ("north_america_europe", "en"),
    "NO": ("north_america_europe", "en"), "CN": ("greater_china", "zh"),
    "TW": ("greater_china", "zh"), "HK": ("greater_china", "zh"),
    "MO": ("greater_china", "zh"), "JP": ("japan", "ja"), "KR": ("korea", "ko"),
    "SG": ("other", "en"), "MY": ("other", "en"), "PH": ("other", "en"),
    "IN": ("other", "en"), "ID": ("other", "en"), "BR": ("other", "en"),
    "MX": ("other", "en"),
}


def derive_market_language(country: str | None) -> tuple[str, str]:
    if not country:
        return "unknown", "unknown"
    return MARKET_LANGUAGE_BY_COUNTRY.get(country, ("other", "unknown"))


ARCHITECTURE_LAYERS = [
    {"layer": "数据层", "status": "live",
     "note": "YouTube真实采集+特征工程，年龄偏差已验证消除（中位数漂移斜率0.002 < 0.05阈值）"},
    {"layer": "匹配层", "status": "live_with_caveat",
     "note": "GBDT潜力分+cosine共振分，非黑箱预训练神经网络——demo规模无真实人货匹配监督标签，无法真训练该类模型"},
    {"layer": "裂变层", "status": "live",
     "note": "DeepSeek真实生成本地化脚本变体/字幕要点，非模板"},
    {"layer": "复盘层", "status": "live_with_caveat",
     "note": "结果录入（前端localStorage）+ 模型归因（真实permutation importance + cosine分维贡献）已上线；"
             "广告投放/转化数据、ROI归因仍待接入——demo没有真实转化数据，不伪造因果看板"},
]


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def cache_dir(name: str, category: str) -> Path:
    return CACHE_ROOT / name / category


def _load_cache_dir(name: str, category: str) -> dict:
    d = cache_dir(name, category)
    if not d.exists():
        return {}
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in d.glob("*.json")}


def load_vision_cache(category: str) -> dict:
    return _load_cache_dir("vision", category)


def load_decisions_cache(category: str) -> dict:
    return _load_cache_dir("decisions", category)


def load_variant_translations_cache(category: str) -> dict:
    """pipeline/translate_variants.py output: real English translations of
    decide.py's creative_variants, for the decisions that don't have full
    Top-20 scripts (which are already bilingual on their own). Missing here
    just means "not translated yet" — build_creator must not fabricate one."""
    return _load_cache_dir("variant_translations", category)


def load_content_translations_cache(category: str) -> dict:
    """pipeline/translate_content.py output: real English translations of
    vision.evidence/sport_types and decision.reasoning/localization_notes/
    risk_review.conclusion/price_range.basis — free-text LLM output that
    isn't a fixed vocabulary (unlike camera_perspective/narrative_pace,
    which the frontend already translates via a dictionary lookup). Missing
    here just means "not translated yet" — build_creator must not fabricate one."""
    return _load_cache_dir("content_translations", category)


def load_scripts_for(channel_id: str, product_id: str, category: str) -> list[dict] | None:
    """pipeline/scripts.py writes one file per (channel, product, platform,
    language): {channel_id}_{product_id}_{platform}_{language}.json. Glob by
    the exact channel_id/product_id prefix rather than splitting the filename
    on "_" — both channel IDs (YouTube's base64url alphabet includes "_") and
    product IDs (e.g. "ace_pro2") can themselves contain underscores, so
    positional parsing would silently misattribute variants."""
    d = cache_dir("scripts", category)
    if not d.exists():
        return None
    matches = sorted(d.glob(f"{channel_id}_{product_id}_*.json"))
    if not matches:
        return None
    return [json.loads(p.read_text(encoding="utf-8")) for p in matches]


def load_products(category: str | None = None) -> list[dict]:
    return config.load_products(category)


def build_creator(
    channel: dict,
    score_entry: dict | None,
    vision: dict | None,
    decision: dict | None,
    variant_translation: dict | None = None,
    content_translation: dict | None = None,
    category: str | None = None,
) -> dict:
    videos_out = [{k: v.get(k) for k in VIDEO_FIELDS} for v in channel["videos"]]
    thumbnails = [v["thumbnail_url"] for v in sorted(channel["videos"], key=lambda v: v["published_at"], reverse=True) if v.get("thumbnail_url")][:8]

    potential = score_entry.get("potential") if score_entry else None
    resonance = score_entry.get("resonance") if score_entry else None
    market, language = derive_market_language(channel.get("country"))

    vision_out = vision
    if vision is not None:
        # pipeline/translate_content.py output, if this channel's been
        # translated yet — sport_types/evidence are free-text LLM output
        # (232 distinct sport_types values seen), not a fixed vocabulary the
        # frontend can look up in a dictionary. None means "not translated
        # yet", not "nothing to translate".
        vision_out = {
            **vision,
            "sport_types_en": content_translation["sport_types_en"] if content_translation else None,
            "evidence_en": content_translation["evidence_en"] if content_translation else None,
        }

    decision_out = decision
    if decision is not None:
        # Stamp language on the original Chinese variants and, if
        # pipeline/translate_variants.py has translated this channel, append
        # the real English versions — frontend filters decision.creative_variants
        # by locale the same way it already filters scripts by platform/language.
        zh_variants = [{**normalize_variant(v), "language": "zh"} for v in decision.get("creative_variants", [])]
        en_variants = (
            [{**v, "language": "en"} for v in variant_translation["creative_variants_en"]]
            if variant_translation
            else []
        )
        decision_out = {
            **decision,
            "creative_variants": zh_variants + en_variants,
            "reasoning_en": content_translation["reasoning_en"] if content_translation else None,
            "localization_notes_en": content_translation["localization_notes_en"] if content_translation else None,
            "risk_review": {
                **decision["risk_review"],
                "conclusion_en": content_translation["risk_review_conclusion_en"] if content_translation else None,
            },
            "price_range": {
                **decision["price_range"],
                "basis_en": content_translation["price_range_basis_en"] if content_translation else None,
            },
        }

    return {
        "channel_id": channel["channel_id"],
        "channel_url": f"https://www.youtube.com/channel/{channel['channel_id']}",
        "title": channel.get("title"),
        "country": channel.get("country"),
        "market": market,
        "language": language,
        "subscriber_count": channel.get("subscriber_count"),
        "view_count_total": channel.get("view_count_total"),
        "video_count_total": channel.get("video_count_total"),
        "channel_age_days": channel.get("channel_age_days"),
        "vertical": channel.get("vertical"),
        # English display label for the (Chinese) internal vertical tag. The UI
        # is English-only apart from YouTube's own channel/video titles, and
        # this is a fixed vocabulary, so it's a config lookup rather than an
        # LLM translation. None means the category config is missing a label —
        # the UI shows nothing rather than falling back to the Chinese tag.
        "vertical_en": config.load_vertical_labels(category).get(channel.get("vertical")),
        "thumbnails": thumbnails,
        "videos": videos_out,
        "features": channel.get("features"),
        "vision": vision_out,  # None if not yet analyzed — frontend must render "待分析"
        "scores": {
            # potential is {"value","value_lo","value_hi","rank_score"} for
            # dual_head_gbdt, or just {"value"} for the heuristic fallback —
            # "method" is filled in below once known globally.
            "potential": {**potential, "method": None} if potential is not None else None,
            "resonance": resonance,  # dict of product_id -> {value, contributions, feature_breakdown}, or None
        },
        "decision": decision_out,  # None if not in the pre-generated set — frontend must render "未生成"
        # Full scripts only exist for the Top-20 (pipeline/scripts.py); None
        # here means "not generated yet", not "no script exists" — frontend
        # falls back to decision.creative_variants when this is null.
        "scripts": load_scripts_for(channel["channel_id"], decision["recommended_product"],
                                    config.resolve(category)) if decision else None,
    }


def run(category: str | None = None) -> dict:
    category = config.resolve(category)
    artifacts = config.artifacts_dir(category)
    features_data = _load_json(artifacts / "features.json")
    scores_data = _load_json(artifacts / "scores.json")
    quota_log = _load_json(QUOTA_LOG_PATH) or {}
    validate_report = _load_json(artifacts / "validate_report.json") or {}
    vision_cache = load_vision_cache(category)
    decisions_cache = load_decisions_cache(category)
    variant_translations_cache = load_variant_translations_cache(category)
    content_translations_cache = load_content_translations_cache(category)
    products = load_products(category)

    channels = features_data["channels"]
    scores_by_id = scores_data["scores"] if scores_data else {}
    potential_meta = scores_data["potential"] if scores_data else None
    potential_method = potential_meta["method"] if potential_meta else None

    creators = []
    for ch in channels:
        cid = ch["channel_id"]
        creators.append(build_creator(
            ch,
            scores_by_id.get(cid),
            vision_cache.get(cid),
            decisions_cache.get(cid),
            variant_translations_cache.get(cid),
            content_translations_cache.get(cid),
            category,
        ))
    # Fill in the per-creator potential method now that we know it globally
    for c in creators:
        if c["scores"]["potential"] is not None:
            c["scores"]["potential"]["method"] = potential_method

    total_videos = sum(len(c["videos"]) for c in channels)
    vision_covered = sum(1 for c in creators if c["vision"] is not None)
    decision_covered = sum(1 for c in creators if c["decision"] is not None)

    dataset = {
        "meta": {
            "fetched_at": features_data["fetched_at"],
            "channel_count": len(channels),
            "video_count": total_videos,
            "quota_used": {**quota_log.get("units", {}), "total": sum(quota_log.get("units", {}).values())},
            "model_status": {
                "potential_score_model": potential_method,
                "gbdt_sample_count": potential_meta["training_sample_count"] if potential_meta else None,
            },
            "vision_coverage": {"analyzed": vision_covered, "total": len(creators),
                                 "note": "免费视觉模型限速，未覆盖频道vision/resonance为null，非缺陷"},
            "decision_coverage": {"generated": decision_covered, "total": len(creators)},
            "age_bias_validation": validate_report.get("drift_check"),
            "data_sources": [
                {"platform": "youtube", "status": "connected"},
                {"platform": "tiktok", "status": "pending"},
                {"platform": "douyin", "status": "pending"},
                {"platform": "xiaohongshu", "status": "pending"},
                {"platform": "bilibili", "status": "pending"},
            ],
            "architecture_layers": ARCHITECTURE_LAYERS,
        },
        "season_coefs": features_data["season_coefs"],
        "channel_split": scores_data["channel_split"] if scores_data else None,
        "potential_model": {
            "method": potential_method,
            "training_sample_count": potential_meta["training_sample_count"],
            "positive_label_rate": potential_meta["positive_label_rate"],
            "label_threshold": potential_meta["threshold_stats"],
            "grade_cuts": potential_meta["grade_cuts"],
            "calibration": potential_meta["calibration"],
            "feature_importance": potential_meta["feature_importance"],
            "permutation_importance": potential_meta.get("permutation_importance"),
        } if potential_meta else None,
        # Stratified Top-K backtest (REFACTOR_PLAN.md §1.4): "global" + one
        # entry per subscriber tier, each with baseline/model hit-rate and
        # lift at K=10/20/50/100. Replaces the old single baseline-vs-model
        # number — a single global lift hid that some tiers (e.g. 1K-10K)
        # can have lift < 1, which is a real, reportable result, not noise
        # to average away.
        "backtest": {
            "primary_k": potential_meta["backtest_stratified"]["primary_k"],
            "k_values": TOP_K_LIST,
            "tiers": [
                {"tier": tier, **potential_meta["backtest_stratified"][tier]}
                for tier in (["global"] + SUBSCRIBER_TIER_NAMES)
            ],
            "excluded_below_1k_count": potential_meta["backtest_stratified"]["excluded_below_1k"]["count"],
        } if potential_meta and potential_meta.get("backtest_stratified") else None,
        # The category's semantic space, so downstream consumers can score a
        # product the pipeline never saw (the onboarding chat lets a visitor
        # describe their own) against the same axes vision.py used. Without
        # this the vectors in `creators` are 8 anonymous numbers.
        "dimensions": [
            {"key": d["key"], "index": d["index"], "name": d["name"], "description": d["description"]}
            for d in config.load_dimensions(category)
        ],
        # Matched keyword -> brand display name. Cards generated before
        # decide.py started mapping these store the raw matcher ("la
        # roche-posay"), so the trim step normalises on the way out and old and
        # new cards render the same.
        "competitor_labels": config.load_competitor_labels(category),
        "products": products,
        "creators": creators,
    }

    out_path = dataset_out_path(category)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("wrote %s (%.1f MB)", out_path, out_path.stat().st_size / 1e6)

    summary = {
        "category": category,
        "channel_count": len(channels),
        "video_count": total_videos,
        "vision_covered": vision_covered,
        "decision_covered": decision_covered,
        "output_path": str(out_path),
        "output_size_mb": round(out_path.stat().st_size / 1e6, 2),
    }
    logger.info("=== DONE === %s", summary)
    return summary


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    config.add_category_argument(parser)
    args = parser.parse_args()
    print(json.dumps(run(args.category), ensure_ascii=False, indent=2))
