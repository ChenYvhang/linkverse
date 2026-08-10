"""Cross-snapshot growth — shared by pipeline/build.py (the real "Live
Potential" feature) and pipeline/experiments/snapshot_momentum.py (the
read-only report that validated the idea before it shipped).

Distinct from features.py's relative_velocity, which compares one video
against *that same channel's own* median and says nothing about change over
calendar time. This compares the same channel against itself, snapshot to
snapshot — real elapsed days, real subscriber movement.

Two things below exist specifically to keep this honest, both found by running
the experiment against real data before this was wired into build.py:

- Snapshot coverage isn't stable: action_camera's snapshots are strict
  supersets of each other (seed keywords grew between collection runs, the
  YouTube roster didn't shrink). A channel missing from an older snapshot is
  unobserved, not new-to-YouTube — `compute_deltas` only scores channels
  present in both, and reports the rest as `only_new_count` rather than
  silently treating "just discovered" as "just grew".
- YouTube rounds subscriberCount above a certain size (confirmed on real data:
  a 26M-subscriber channel's only visible deltas are +100000 steps). Rates are
  reported per day (`sub_delta_pct_per_day`) precisely so a real small-channel
  move isn't swamped by a large channel's rounding noise when ranked.
"""
import json
from datetime import datetime
from pathlib import Path

from pipeline.common import config

MIN_ELAPSED_DAYS = 0.5  # below this, two collection runs are effectively the
# same run (e.g. this project's own two same-day 2026-07-15 snapshots, 5
# minutes apart) and any %/day rate computed from them is noise amplified by
# division, not signal.


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def load_snapshots(category: str) -> list[dict]:
    """All raw collection snapshots for a category, oldest first."""
    raw_dir = config.raw_dir(category)
    files = sorted(raw_dir.glob("channels_*.json"))
    snaps = []
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        snaps.append({"path": f, "fetched_at": _parse_iso(d["fetched_at"]), "channels": d["channels"]})
    return snaps


def compute_deltas(old: dict, new: dict) -> dict:
    """Per-channel growth for every channel present in both snapshots, plus
    counts (not identities — the caller decides what if anything to do with
    them) for channels only one snapshot saw."""
    by_old = {c["channel_id"]: c for c in old["channels"]}
    by_new = {c["channel_id"]: c for c in new["channels"]}
    overlap = set(by_old) & set(by_new)
    elapsed_days = (new["fetched_at"] - old["fetched_at"]).total_seconds() / 86400

    rows = []
    if elapsed_days > 0:
        for cid in overlap:
            a, b = by_old[cid], by_new[cid]
            sa, sb = a.get("subscriber_count"), b.get("subscriber_count")
            vca, vcb = a.get("video_count_total"), b.get("video_count_total")
            if sa is None or sb is None or sa <= 0:
                continue
            rows.append({
                "channel_id": cid,
                "subs_before": sa,
                "subs_after": sb,
                "sub_delta_pct_per_day": (sb - sa) / sa * 100 / elapsed_days,
                "new_videos": (vcb - vca) if vca is not None and vcb is not None else None,
            })

    return {
        "fetched_at_old": old["fetched_at"].isoformat(),
        "fetched_at_new": new["fetched_at"].isoformat(),
        "elapsed_days": elapsed_days,
        "overlap_count": len(overlap),
        "only_new_count": len(by_new) - len(overlap),
        "rows": rows,
    }


def latest_momentum(category: str, top_n: int = 20) -> dict:
    """What pipeline/build.py needs: growth over the most recent snapshot
    pair, or an honest `available: false` when there isn't one yet.

    Display fields (title, thumbnail, current subscriber count) are
    deliberately NOT included here — those live in features.json, which the
    caller already has loaded, and duplicating that lookup here would mean two
    sources of truth for a channel's current title/thumbnail.
    """
    snaps = load_snapshots(category)
    if len(snaps) < 2:
        return {"available": False, "reason": "only_one_snapshot", "snapshot_count": len(snaps)}

    old, new = snaps[-2], snaps[-1]
    d = compute_deltas(old, new)
    if d["elapsed_days"] < MIN_ELAPSED_DAYS:
        return {
            "available": False,
            "reason": "snapshots_too_close",
            "snapshot_count": len(snaps),
            "elapsed_days": d["elapsed_days"],
        }

    movers = sorted(
        (r for r in d["rows"] if r["sub_delta_pct_per_day"] > 0),
        key=lambda r: -r["sub_delta_pct_per_day"],
    )[:top_n]

    return {
        "available": True,
        "fetched_at_old": d["fetched_at_old"],
        "fetched_at_new": d["fetched_at_new"],
        "elapsed_days": d["elapsed_days"],
        "scored_count": len(d["rows"]),
        "only_new_count": d["only_new_count"],
        "movers": movers,
    }
