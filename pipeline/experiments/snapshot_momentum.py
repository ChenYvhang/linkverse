"""EXPERIMENT — not wired into the pipeline. Read-only, changes no production
output. See pipeline/experiments/README.md for what this is and isn't.

Question: does re-collecting the same category later and diffing two raw
snapshots produce a real, usable "this channel is accelerating" signal — as
distinct from the pipeline's existing `relative_velocity` (features.py), which
compares one video against *that same channel's own* median and says nothing
about change over calendar time?

Uses the two action_camera snapshots already on disk (2026-07-15, 2026-07-17,
518 overlapping channels) — zero YouTube quota spent running this.

Two things this script exists to catch, because both would silently corrupt a
real "momentum" feature if unguarded:

1. Snapshot coverage isn't fixed. action_camera's snapshots are strict
   supersets (0 channels ever drop out; discovery only ever adds more, since
   the seed keyword list grew between them, not because the channel roster on
   YouTube changed). A channel absent from an older snapshot is *unobserved*,
   not *new to YouTube* — scoring it as "just appeared, must be exploding"
   would be a fabricated inference. This script computes deltas only over the
   channels present in BOTH snapshots and reports newly-observed channels
   separately, unscored.

2. YouTube's `subscriberCount` is displayed rounded/bucketed by YouTube itself
   above a certain size (the deltas below are suspiciously round numbers like
   +100000 on multi-million-subscriber channels) — so subscriber-delta
   momentum is noisiest on exactly the channels that matter least to this
   product's thesis (catch them *before* they're huge) and should be usable on
   the small/mid channels where the count is closer to exact.

Run:
    python -m pipeline.experiments.snapshot_momentum --category action_camera
"""
import argparse
import json
import statistics
from datetime import datetime
from pathlib import Path

from pipeline.common import config

ROOT = Path(__file__).resolve().parent.parent


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def load_snapshots(category: str) -> list[dict]:
    raw_dir = config.raw_dir(category)
    files = sorted(raw_dir.glob("channels_*.json"))
    snaps = []
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        snaps.append({"path": f, "fetched_at": _parse_iso(d["fetched_at"]), "channels": d["channels"]})
    return snaps


def compute_deltas(old: dict, new: dict) -> dict:
    by_old = {c["channel_id"]: c for c in old["channels"]}
    by_new = {c["channel_id"]: c for c in new["channels"]}
    overlap = set(by_old) & set(by_new)
    only_new = set(by_new) - set(by_old)
    only_old = set(by_old) - set(by_new)

    elapsed_days = (new["fetched_at"] - old["fetched_at"]).total_seconds() / 86400
    rows = []
    for cid in overlap:
        a, b = by_old[cid], by_new[cid]
        sa, sb = a.get("subscriber_count"), b.get("subscriber_count")
        va, vb = a.get("view_count_total"), b.get("view_count_total")
        vca, vcb = a.get("video_count_total"), b.get("video_count_total")
        if sa is None or sb is None or sa <= 0 or elapsed_days <= 0:
            continue
        sub_delta = sb - sa
        rows.append({
            "channel_id": cid,
            "title": b.get("title"),
            "subs_before": sa,
            "subs_after": sb,
            "sub_delta": sub_delta,
            "sub_delta_pct_per_day": (sub_delta / sa * 100) / elapsed_days,
            "view_delta": (vb - va) if va is not None and vb is not None else None,
            "new_videos": (vcb - vca) if vca is not None and vcb is not None else None,
        })

    return {
        "elapsed_days": elapsed_days,
        "overlap_count": len(overlap),
        "only_new_count": len(only_new),
        "only_old_count": len(only_old),
        "only_new_titles": [by_new[c]["title"] for c in list(only_new)[:5]],
        "rows": rows,
    }


def run(category: str) -> None:
    snaps = load_snapshots(category)
    if len(snaps) < 2:
        print(f"only {len(snaps)} snapshot(s) for {category!r} — need >= 2 to diff. "
              f"Nothing to compare yet (run collect.py again later to get a second one).")
        return

    print(f"{len(snaps)} snapshots found for {category!r}:")
    for s in snaps:
        print(f"  {s['fetched_at'].isoformat()}  {len(s['channels'])} channels  ({s['path'].name})")

    for i in range(len(snaps) - 1):
        old, new = snaps[i], snaps[i + 1]
        d = compute_deltas(old, new)
        print(f"\n=== {old['fetched_at'].date()} -> {new['fetched_at'].date()} "
              f"({d['elapsed_days']:.2f} days) ===")
        print(f"  overlap (real diff possible): {d['overlap_count']}")
        print(f"  newly observed (unscored — coverage expanded, not necessarily new to YouTube): "
              f"{d['only_new_count']}")
        if d["only_old_count"]:
            print(f"  dropped from newer snapshot: {d['only_old_count']} "
                  "(worth checking whether these are gone or just under a re-collection quirk)")

        rows = d["rows"]
        if not rows:
            continue
        rates = [r["sub_delta_pct_per_day"] for r in rows]
        print(f"  subscriber growth rate (%/day) over the {len(rows)} scoreable channels: "
              f"median={statistics.median(rates):.3f} p90={sorted(rates)[int(len(rates)*0.9)]:.3f}")

        top = sorted(rows, key=lambda r: -r["sub_delta_pct_per_day"])[:8]
        print("  fastest-growing (by %/day, not raw count — a small channel doubling matters more")
        print("  to this product's thesis than a 26M-subscriber channel's rounding noise):")
        for r in top:
            print(f"    {r['title'][:32]:<32} {r['subs_before']:>10,} -> {r['subs_after']:>10,}  "
                  f"({r['sub_delta_pct_per_day']:+.3f}%/day, +{r['new_videos'] or 0} videos)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    config.add_category_argument(parser)
    args = parser.parse_args()
    run(config.resolve(args.category))
