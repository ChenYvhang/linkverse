"""YouTube Data API v3 quota tracker.

Single execution point for the project's quota red line: every API call must be
charged here before it counts as "spent". Charges persist to disk keyed by UTC
date so a crashed/restarted run does not blow past the daily 10000 unit cap.

Budget table (see PLAN.md section 2):
  search.list        100 units/call, hard cap 20 calls  (seed discovery only)
  channels.list       1 unit/call   (batch up to 50 ids)
  playlistItems.list  1 unit/call   (one call per channel)
  videos.list         1 unit/call   (batch up to 50 ids)
"""
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from pipeline.common.logging import get_logger

logger = get_logger("quota")

ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "artifacts"
QUOTA_LOG_PATH = ARTIFACTS_DIR / "quota_log.json"

UNIT_COST = {
    "search": 100,
    "channels": 1,
    "playlistItems": 1,
    "videos": 1,
}

CALL_CAP = {
    # 2026-07-18: raised 20 -> 90 for the 518->2000+ channel expansion
    # (REFACTOR_PLAN.md §3.1 decision 1, approved by user). The daily
    # DAILY_UNIT_BUDGET check below is the real backstop against overspend —
    # this call-count cap exists so a config/loop bug can't spin indefinitely,
    # not to arbitrarily block a larger, deliberately-planned discovery run.
    "search": 90,
}

DAILY_UNIT_BUDGET = 10000


class QuotaExceededError(RuntimeError):
    pass


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


@dataclass
class QuotaTracker:
    date: str = field(default_factory=_today)
    calls: dict = field(default_factory=lambda: {k: 0 for k in UNIT_COST})
    units: dict = field(default_factory=lambda: {k: 0 for k in UNIT_COST})

    def __post_init__(self):
        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        self._load()

    def _load(self):
        if not QUOTA_LOG_PATH.exists():
            return
        try:
            data = json.loads(QUOTA_LOG_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            logger.warning("quota_log.json unreadable, starting fresh count")
            return
        if data.get("date") == self.date:
            self.calls = data.get("calls", self.calls)
            self.units = data.get("units", self.units)
            logger.info("resumed quota state for %s: %s", self.date, self.units)

    def _save(self):
        QUOTA_LOG_PATH.write_text(
            json.dumps({"date": self.date, "calls": self.calls, "units": self.units}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def charge(self, operation: str, calls: int = 1):
        if operation not in UNIT_COST:
            raise ValueError(f"unknown operation: {operation}")

        cap = CALL_CAP.get(operation)
        if cap is not None and self.calls[operation] + calls > cap:
            raise QuotaExceededError(
                f"{operation}.list call cap exceeded: {self.calls[operation]} + {calls} > {cap}"
            )

        cost = UNIT_COST[operation] * calls
        total_after = sum(self.units.values()) + cost
        if total_after > DAILY_UNIT_BUDGET:
            raise QuotaExceededError(
                f"daily unit budget exceeded: {total_after} > {DAILY_UNIT_BUDGET}"
            )

        self.calls[operation] += calls
        self.units[operation] += cost
        self._save()
        logger.info(
            "charged %s x%d (+%d units) — running total %s (%d units)",
            operation, calls, cost, self.units, sum(self.units.values()),
        )

    def summary(self) -> dict:
        return {
            "date": self.date,
            "calls": dict(self.calls),
            "units": dict(self.units),
            "total_units": sum(self.units.values()),
        }
