"""Stage2 — feature engineering.

The only time-series signal available is (published_at, view_count) per video.
viewCount is cumulative, so a naive views/age_days ratio systematically
underrates older videos (they've had more time to accumulate) and overrates
brand-new ones — silently, with no error, just a garbage ranking. The fix:

  relative_velocity = video's view_count / median view_count of *same-channel,
                       same-age-bucket* videos

This compares each video only against peers that have had the same amount of
time to accumulate views, which cancels out the cumulative-time effect.
See validate_features.py for the check that this actually worked.

Run:
    python -m pipeline.features
Reads the newest pipeline/raw/youtube/channels_*.json, writes
pipeline/artifacts/features.json.
"""
import json
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

from pipeline.common.logging import get_logger

logger = get_logger("features")

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "raw" / "youtube"
ARTIFACTS_DIR = ROOT / "artifacts"
FEATURES_OUT_PATH = ARTIFACTS_DIR / "features.json"

# Age bucket boundaries in days: (name, lower_inclusive, upper_exclusive|None)
BUCKET_DEFS = [
    ("0-7", 0, 7),
    ("7-30", 7, 30),
    ("30-90", 30, 90),
    ("90-365", 90, 365),
    ("365+", 365, None),
]
MIN_BUCKET_SAMPLE = 3
RECENT_WINDOW_BUCKETS = {"0-7", "7-30", "30-90"}  # <=90 days: "近期"
EARLY_WINDOW_BUCKETS = {"90-365", "365+"}  # >90 days: "早期"
RECENT_CADENCE_DAYS = (30, 90)
SEASON_MONTH_MIN_SAMPLE = 10


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _iso8601_duration_to_seconds(duration: str | None) -> int | None:
    if not duration:
        return None
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not m:
        return None
    h, mnt, s = (int(g) if g else 0 for g in m.groups())
    return h * 3600 + mnt * 60 + s


def _bucket_index(age_days: int) -> int:
    for i, (_, lo, hi) in enumerate(BUCKET_DEFS):
        if age_days >= lo and (hi is None or age_days < hi):
            return i
    return len(BUCKET_DEFS) - 1


def _latest_raw_file() -> Path:
    files = sorted(RAW_DIR.glob("channels_*.json"))
    if not files:
        raise SystemExit(f"no raw collection files found in {RAW_DIR} — run collect.py first")
    return files[-1]


def _linear_slope(xs: list[float], ys: list[float]) -> float | None:
    """Closed-form OLS slope; None if fewer than 2 distinct x values."""
    n = len(xs)
    if n < 2 or len(set(xs)) < 2:
        return None
    mean_x, mean_y = sum(xs) / n, sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den = sum((x - mean_x) ** 2 for x in xs)
    return num / den if den else None


def compute_relative_velocity(videos: list[dict], fetched_at: datetime) -> None:
    """Mutate videos in place: add age_days, age_bucket, relative_velocity.

    Groups are merged across adjacent age buckets when a bucket has <3
    samples, so the "peer median" is never computed from a near-empty group.
    """
    for v in videos:
        age_days = max((fetched_at - _parse_iso(v["published_at"])).days, 0)
        v["age_days"] = age_days
        v["_bucket_idx"] = _bucket_index(age_days)
        v["age_bucket"] = BUCKET_DEFS[v["_bucket_idx"]][0]

    # groups: list of {"indices": [bucket_idx...], "videos": [...]}, kept sorted by bucket index
    by_bucket: dict[int, list[dict]] = {}
    for v in videos:
        by_bucket.setdefault(v["_bucket_idx"], []).append(v)
    groups = [{"indices": [i], "videos": vids} for i, vids in sorted(by_bucket.items())]

    def mean_age(group) -> float:
        return sum(v["age_days"] for v in group["videos"]) / len(group["videos"])

    changed = True
    while changed and len(groups) > 1:
        changed = False
        for pos, g in enumerate(groups):
            if len(g["videos"]) >= MIN_BUCKET_SAMPLE:
                continue
            left = groups[pos - 1] if pos > 0 else None
            right = groups[pos + 1] if pos < len(groups) - 1 else None
            if left is None and right is None:
                break
            if left is None:
                target = right
            elif right is None:
                target = left
            else:
                # merge into whichever neighbor's mean age is closer in time
                target = left if abs(mean_age(g) - mean_age(left)) <= abs(mean_age(g) - mean_age(right)) else right
            target["indices"] = sorted(target["indices"] + g["indices"])
            target["videos"] = target["videos"] + g["videos"]
            groups.remove(g)
            changed = True
            break

    for g in groups:
        views = [v["view_count"] for v in g["videos"]]
        if len(g["videos"]) < MIN_BUCKET_SAMPLE:
            for v in g["videos"]:
                v["relative_velocity"] = None
            continue
        median_views = statistics.median(views)
        for v in g["videos"]:
            v["relative_velocity"] = (v["view_count"] / median_views) if median_views > 0 else None

    for v in videos:
        del v["_bucket_idx"]


def detect_inflection_point(videos: list[dict]) -> str | None:
    """Find the most recent point where relative_velocity turns from falling to rising.

    Smoothed with a 3-point moving average to avoid reacting to single-video
    noise. Returns the published_at of that turning-point video, or None if
    there are too few points or no such turn exists.
    """
    pts = sorted(
        (v for v in videos if v.get("relative_velocity") is not None),
        key=lambda v: v["published_at"],
    )
    if len(pts) < 5:
        return None
    values = [v["relative_velocity"] for v in pts]
    smoothed = []
    for i in range(len(values)):
        lo, hi = max(0, i - 1), min(len(values), i + 2)
        smoothed.append(sum(values[lo:hi]) / (hi - lo))

    last_turn_idx = None
    for i in range(1, len(smoothed) - 1):
        falling_before = smoothed[i] < smoothed[i - 1]
        rising_after = smoothed[i + 1] > smoothed[i]
        if falling_before and rising_after:
            last_turn_idx = i
    return pts[last_turn_idx]["published_at"] if last_turn_idx is not None else None


def compute_channel_features(channel: dict, fetched_at: datetime) -> dict:
    videos = channel["videos"]
    n = len(videos)

    cadence_30 = sum(1 for v in videos if v["age_days"] <= RECENT_CADENCE_DAYS[0])
    cadence_90 = sum(1 for v in videos if v["age_days"] <= RECENT_CADENCE_DAYS[1])

    sorted_by_time = sorted(videos, key=lambda v: v["published_at"])
    published_dt = [_parse_iso(v["published_at"]) for v in sorted_by_time]
    intervals = [(b - a).total_seconds() / 86400 for a, b in zip(published_dt, published_dt[1:])]
    interval_mean = sum(intervals) / len(intervals) if intervals else None
    interval_std = statistics.stdev(intervals) if len(intervals) >= 2 else None

    def engagement_ratio(v, field):
        val = v.get(field)
        return (val / v["view_count"]) if val is not None and v["view_count"] > 0 else None

    like_ratios = [r for v in videos if (r := engagement_ratio(v, "like_count")) is not None]
    comment_ratios = [r for v in videos if (r := engagement_ratio(v, "comment_count")) is not None]
    like_ratio_mean = sum(like_ratios) / len(like_ratios) if like_ratios else None
    comment_ratio_mean = sum(comment_ratios) / len(comment_ratios) if comment_ratios else None

    engagement_series = [
        (v["age_days"], engagement_ratio(v, "like_count"))
        for v in videos
        if engagement_ratio(v, "like_count") is not None
    ]
    # age_days counts down to "now": negate so x increases forward in time
    engagement_trend = _linear_slope([-a for a, _ in engagement_series], [r for _, r in engagement_series])

    recent_rv = [v["relative_velocity"] for v in videos if v["age_bucket"] in RECENT_WINDOW_BUCKETS and v["relative_velocity"] is not None]
    early_rv = [v["relative_velocity"] for v in videos if v["age_bucket"] in EARLY_WINDOW_BUCKETS and v["relative_velocity"] is not None]
    recent_mean = sum(recent_rv) / len(recent_rv) if recent_rv else None
    early_mean = sum(early_rv) / len(early_rv) if early_rv else None
    momentum_acceleration = (recent_mean - early_mean) if recent_mean is not None and early_mean is not None else None

    inflection_point = detect_inflection_point(videos)

    subscriber_count = channel.get("subscriber_count")
    view_count_total = channel.get("view_count_total") or 0
    subscriber_view_ratio = (subscriber_count / view_count_total) if subscriber_count is not None and view_count_total > 0 else None

    return {
        "publish_cadence_30d": cadence_30,
        "publish_cadence_90d": cadence_90,
        "publish_interval_mean_days": interval_mean,
        "publish_interval_std_days": interval_std,
        "recent_relative_velocity_mean": recent_mean,
        "engagement_like_ratio": like_ratio_mean,
        "engagement_comment_ratio": comment_ratio_mean,
        "engagement_trend": engagement_trend,
        "momentum_acceleration": momentum_acceleration,
        "inflection_point": inflection_point,
        "raw_momentum": recent_mean,
        "subscriber_view_ratio": subscriber_view_ratio,
        "video_count_with_velocity": n - sum(1 for v in videos if v["relative_velocity"] is None),
    }


def compute_season_coefs(channels: list[dict]) -> dict:
    """Estimate a 12-month seasonal multiplier per vertical from real data.

    month is taken from each video's published_at (not fetched_at) so the
    coefficient reflects "how do videos published in month M usually perform",
    independent of when the snapshot was taken.
    """
    by_vertical_month: dict[str, dict[int, list[float]]] = {}
    for ch in channels:
        vertical = ch.get("vertical", "未分类")
        for v in ch["videos"]:
            if v["relative_velocity"] is None:
                continue
            month = _parse_iso(v["published_at"]).month
            by_vertical_month.setdefault(vertical, {}).setdefault(month, []).append(v["relative_velocity"])

    season_coefs = {}
    for vertical, month_map in by_vertical_month.items():
        total_sample = sum(len(vals) for vals in month_map.values())
        # Use median, not mean: relative_velocity is right-skewed (rare viral
        # videos), so a month's mean can be dominated by 1-2 outliers — see
        # validate_features.py's age-bucket drift check, which hit the same
        # issue and was fixed the same way.
        raw_month_median = {}
        for month, vals in month_map.items():
            if len(vals) >= SEASON_MONTH_MIN_SAMPLE:
                raw_month_median[month] = statistics.median(vals)

        if not raw_month_median:
            season_coefs[vertical] = {
                "coefs": [1.0] * 12,
                "insufficient_sample": True,
                "sample_size": total_sample,
            }
            continue

        annual_median = statistics.median(raw_month_median.values())
        coefs = [
            (raw_month_median[m] / annual_median) if m in raw_month_median and annual_median else 1.0
            for m in range(1, 13)
        ]
        season_coefs[vertical] = {
            "coefs": coefs,
            "insufficient_sample": len(raw_month_median) < 12,
            "sample_size": total_sample,
        }
    return season_coefs


def apply_season_adjustment(channels: list[dict], season_coefs: dict) -> None:
    for ch in channels:
        vertical = ch.get("vertical", "未分类")
        coefs = season_coefs.get(vertical, {}).get("coefs", [1.0] * 12)
        adjusted_recent = []
        for v in ch["videos"]:
            if v["relative_velocity"] is None:
                v["season_adjusted_velocity"] = None
                continue
            month = _parse_iso(v["published_at"]).month
            coef = coefs[month - 1] or 1.0
            v["season_adjusted_velocity"] = v["relative_velocity"] / coef
            if v["age_bucket"] in RECENT_WINDOW_BUCKETS:
                adjusted_recent.append(v["season_adjusted_velocity"])
        ch["features"]["adjusted_momentum"] = (
            sum(adjusted_recent) / len(adjusted_recent) if adjusted_recent else None
        )


def run() -> dict:
    raw_path = _latest_raw_file()
    logger.info("loading %s", raw_path)
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    fetched_at = _parse_iso(raw["fetched_at"])
    channels = raw["channels"]

    for ch in channels:
        for v in ch["videos"]:
            v["duration_seconds"] = _iso8601_duration_to_seconds(v.get("duration"))
        compute_relative_velocity(ch["videos"], fetched_at)

    for ch in channels:
        ch["features"] = compute_channel_features(ch, fetched_at)

    season_coefs = compute_season_coefs(channels)
    apply_season_adjustment(channels, season_coefs)

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    out = {"fetched_at": raw["fetched_at"], "channels": channels, "season_coefs": season_coefs}
    FEATURES_OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("wrote %s (%d channels)", FEATURES_OUT_PATH, len(channels))
    return {"channel_count": len(channels), "season_coefs_verticals": list(season_coefs.keys())}


if __name__ == "__main__":
    result = run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
