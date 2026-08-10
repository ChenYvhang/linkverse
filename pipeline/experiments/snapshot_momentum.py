"""EXPERIMENT — read-only report, changes no production output. See
pipeline/experiments/README.md for what this directory is.

The logic this prints now lives in pipeline/common/momentum.py, because
pipeline/build.py's real "Live Potential" feature needs the same
snapshot-diffing math this experiment validated. This script is what's left:
a CLI report over every consecutive snapshot pair, for eyeballing the numbers
by hand rather than consuming the trimmed single-pair output build.py emits.

Run:
    python -m pipeline.experiments.snapshot_momentum --category action_camera
"""
import argparse
import statistics

from pipeline.common import config, momentum


def run(category: str) -> None:
    snaps = momentum.load_snapshots(category)
    if len(snaps) < 2:
        print(f"only {len(snaps)} snapshot(s) for {category!r} — need >= 2 to diff. "
              f"Nothing to compare yet (run collect.py again later to get a second one).")
        return

    print(f"{len(snaps)} snapshots found for {category!r}:")
    for s in snaps:
        print(f"  {s['fetched_at'].isoformat()}  {len(s['channels'])} channels  ({s['path'].name})")

    id_to_title = {c["channel_id"]: c["title"] for s in snaps for c in s["channels"]}

    for i in range(len(snaps) - 1):
        old, new = snaps[i], snaps[i + 1]
        d = momentum.compute_deltas(old, new)
        print(f"\n=== {old['fetched_at'].date()} -> {new['fetched_at'].date()} "
              f"({d['elapsed_days']:.2f} days) ===")
        print(f"  overlap (real diff possible): {d['overlap_count']}")
        print(f"  newly observed (unscored — coverage expanded, not necessarily new to YouTube): "
              f"{d['only_new_count']}")

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
            title = id_to_title.get(r["channel_id"], r["channel_id"])
            print(f"    {title[:32]:<32} {r['subs_before']:>10,} -> {r['subs_after']:>10,}  "
                  f"({r['sub_delta_pct_per_day']:+.3f}%/day, +{r['new_videos'] or 0} videos)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    config.add_category_argument(parser)
    args = parser.parse_args()
    run(config.resolve(args.category))
