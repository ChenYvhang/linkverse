"""Stage1 — YouTube collection.

Seed search (search.list, capped at 20 calls total) -> channel snapshots
(channels.list) -> uploads video ids (playlistItems.list) -> video details
(videos.list). Single snapshot, no daily re-crawl. Every "days since" figure
downstream is computed relative to fetched_at recorded here.

Compliance: public API only, no login/captcha bypass, no contact info stored.
See pipeline/adapters/youtube_adapter.py for the per-call notes.

Usage:
    python -m pipeline.collect --limit-channels 20   # validation run
    python -m pipeline.collect                        # full run
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv

from pipeline.adapters.youtube_adapter import YouTubeAdapter
from pipeline.common.logging import get_logger
from pipeline.common.quota import QuotaTracker

logger = get_logger("collect")

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config" / "seeds.yaml"
RAW_DIR = ROOT / "raw" / "youtube"
SEED_CACHE_PATH = ROOT / "artifacts" / "seed_channels.json"

MIN_VIDEO_COUNT = 15
MIN_CHANNEL_AGE_DAYS = 90
MAX_VIDEOS_PER_CHANNEL = 50


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def load_seeds() -> list[dict]:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data["seeds"]


def _print_quota_budget_plan(quota: QuotaTracker, extend_calls: int | None, existing_candidate_count: int) -> None:
    """Informational pre-flight estimate (REFACTOR_PLAN.md §3.1: 'print the
    budget table before running'). Not a gate — the real backstop is
    QuotaTracker's DAILY_UNIT_BUDGET check, which raises on every call, not
    just at the start."""
    already_used = sum(quota.units.values())
    search_cost = (extend_calls or 0) * 100
    # rough yield assumption for logging only, not used to block anything:
    # type=channel search historically yields ~30-50 unique channels/call
    # before cross-call dedup; call it 35/call net-new as a conservative mid estimate.
    est_new_candidates_lo = int((extend_calls or 0) * 20)
    est_new_candidates_hi = int((extend_calls or 0) * 45)
    est_total_candidates_lo = existing_candidate_count + est_new_candidates_lo
    est_total_candidates_hi = existing_candidate_count + est_new_candidates_hi
    # collection cost ~2 units/candidate (1 playlistItems.list + ~1 videos.list share)
    est_collection_cost_lo = est_total_candidates_lo * 2
    est_collection_cost_hi = est_total_candidates_hi * 2
    logger.info("=== 配额预算表（今日已用 %d units，日预算 %d units）===", already_used, DAILY_UNIT_BUDGET_FOR_LOG)
    logger.info("计划新增 search.list 调用: %d 次 x 100 units = %d units", extend_calls or 0, search_cost)
    logger.info("预计新增候选频道: %d-%d（现有候选 %d，估算总候选 %d-%d）",
                est_new_candidates_lo, est_new_candidates_hi, existing_candidate_count,
                est_total_candidates_lo, est_total_candidates_hi)
    logger.info("预计下游采集消耗（channels/playlistItems/videos.list，约2 units/候选频道）: %d-%d units",
                est_collection_cost_lo, est_collection_cost_hi)
    logger.info("预计今日总消耗: %d-%d units（含已用 %d units）",
                already_used + search_cost + est_collection_cost_lo,
                already_used + search_cost + est_collection_cost_hi, already_used)


DAILY_UNIT_BUDGET_FOR_LOG = 10000  # mirrors quota.DAILY_UNIT_BUDGET, for the log line only


def run(limit_channels: int | None, max_search_calls: int | None, force_search_refresh: bool = False,
        extend_discovery_calls: int | None = None, extend_search_type: str = "channel"):
    load_dotenv(ROOT.parent / ".env")
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        raise SystemExit("YOUTUBE_API_KEY not set — copy .env.example to .env and fill it in")

    seeds = load_seeds()
    if max_search_calls is None:
        max_search_calls = min(len(seeds), 20)

    fetched_at = datetime.now(timezone.utc)
    fetched_at_iso = fetched_at.isoformat()

    quota = QuotaTracker()
    adapter = YouTubeAdapter(api_key=api_key, quota=quota)

    if SEED_CACHE_PATH.exists() and not force_search_refresh:
        channel_vertical = json.loads(SEED_CACHE_PATH.read_text(encoding="utf-8"))
        logger.info(
            "=== seed discovery: reusing cached results (%d channels) from %s — "
            "search.list is a one-time cost for the whole project, not per run ===",
            len(channel_vertical), SEED_CACHE_PATH,
        )
        if extend_discovery_calls:
            _print_quota_budget_plan(quota, extend_discovery_calls, len(channel_vertical))
            logger.info(
                "=== extending seed discovery: %d new search.list calls (type=%s) ===",
                extend_discovery_calls, extend_search_type,
            )
            newly_found = adapter.discover_seed_channels(seeds, extend_discovery_calls, search_type=extend_search_type)
            added = 0
            for cid, vertical in newly_found.items():
                if cid not in channel_vertical:
                    channel_vertical[cid] = vertical
                    added += 1
            logger.info("extend discovery done: +%d new unique channels (total now %d)", added, len(channel_vertical))
            SEED_CACHE_PATH.write_text(json.dumps(channel_vertical, ensure_ascii=False, indent=2), encoding="utf-8")
            logger.info("updated cached seed discovery results at %s", SEED_CACHE_PATH)
    else:
        logger.info("=== seed discovery (%d seeds, max %d search.list calls) ===", len(seeds), max_search_calls)
        channel_vertical = adapter.discover_seed_channels(seeds, max_search_calls)
        SEED_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        SEED_CACHE_PATH.write_text(json.dumps(channel_vertical, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("cached seed discovery results to %s", SEED_CACHE_PATH)
    channel_ids = list(channel_vertical.keys())
    logger.info("discovered %d unique candidate channels", len(channel_ids))

    if limit_channels:
        channel_ids = channel_ids[:limit_channels]
        logger.info("validation mode: truncated to %d channels", len(channel_ids))

    logger.info("=== channel snapshots ===")
    snapshots = adapter.fetch_channel_snapshots(channel_ids)
    logger.info("fetched %d channel snapshots", len(snapshots))

    kept, dropped_low_videos, dropped_young = [], 0, 0
    for snap in snapshots:
        published_at = snap.get("published_at")
        age_days = (fetched_at - _parse_iso(published_at)).days if published_at else None
        snap["channel_age_days"] = age_days
        snap["vertical"] = channel_vertical.get(snap["channel_id"], "未分类")

        if snap["video_count_total"] < MIN_VIDEO_COUNT:
            dropped_low_videos += 1
            continue
        if age_days is not None and age_days < MIN_CHANNEL_AGE_DAYS:
            dropped_young += 1
            continue
        kept.append(snap)

    logger.info(
        "kept %d channels (dropped %d for <%d videos, %d for <%d days old)",
        len(kept), dropped_low_videos, MIN_VIDEO_COUNT, dropped_young, MIN_CHANNEL_AGE_DAYS,
    )

    logger.info("=== uploads playlist -> recent video ids ===")
    channel_video_ids: dict[str, list[str]] = {}
    for snap in kept:
        vids = adapter.fetch_uploads_video_ids(snap["uploads_playlist_id"], MAX_VIDEOS_PER_CHANNEL)
        channel_video_ids[snap["channel_id"]] = vids
        logger.info("channel=%s (%s) -> %d video ids", snap["channel_id"], snap["title"], len(vids))

    all_video_ids = [vid for vids in channel_video_ids.values() for vid in vids]
    logger.info("=== video details for %d videos ===", len(all_video_ids))
    video_details = adapter.fetch_video_details(all_video_ids)
    video_by_id = {v["video_id"]: v for v in video_details}

    channels_out = []
    total_videos = 0
    for snap in kept:
        vids = [video_by_id[vid] for vid in channel_video_ids[snap["channel_id"]] if vid in video_by_id]
        total_videos += len(vids)
        channels_out.append({**snap, "videos": vids})

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RAW_DIR / f"channels_{fetched_at.strftime('%Y%m%dT%H%M%SZ')}.json"
    out_path.write_text(
        json.dumps({"fetched_at": fetched_at_iso, "channels": channels_out}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = quota.summary()
    logger.info("=== DONE ===")
    logger.info("channels written: %d, total videos: %d", len(channels_out), total_videos)
    logger.info("quota summary: %s", summary)
    logger.info("output: %s", out_path)
    return {
        "channels_discovered": len(channel_vertical),
        "channels_kept": len(channels_out),
        "dropped_low_videos": dropped_low_videos,
        "dropped_young": dropped_young,
        "total_videos": total_videos,
        "quota": summary,
        "output_path": str(out_path),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-channels", type=int, default=None, help="truncate to N channels (validation runs)")
    parser.add_argument("--max-search-calls", type=int, default=None, help="override search.list call cap (<=20)")
    parser.add_argument(
        "--force-search-refresh", action="store_true",
        help="re-run search.list discovery even if a seed cache exists (spends search quota again)",
    )
    parser.add_argument(
        "--extend-discovery-calls", type=int, default=None,
        help="run N additional search.list calls to grow the cached candidate pool without discarding it",
    )
    parser.add_argument(
        "--extend-search-type", default="channel", choices=["channel", "video"],
        help="search.list 'type' param for the extension calls (default: channel)",
    )
    args = parser.parse_args()
    result = run(
        args.limit_channels, args.max_search_calls, args.force_search_refresh,
        args.extend_discovery_calls, args.extend_search_type,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
