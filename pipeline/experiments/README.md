# Experiments

Exploratory scripts. Read-only against existing data, zero YouTube quota,
never imported by the production pipeline (`collect.py` → `build.py`). A
finding here doesn't ship until it's deliberately wired into the real
pipeline — this directory is where an idea gets tested before that decision.

## `snapshot_momentum.py`

Question: does re-collecting a category later and diffing raw snapshots give
a real "this channel is accelerating" signal, distinct from the existing
`relative_velocity` (which compares a video against *that same channel's own*
median — it says nothing about calendar-time change)?

```
python -m pipeline.experiments.snapshot_momentum --category action_camera
```

See the module docstring for what it does and does not account for (mainly:
snapshot coverage isn't stable, so "new since last time" must not be read as
"grew since last time" — see findings below).
