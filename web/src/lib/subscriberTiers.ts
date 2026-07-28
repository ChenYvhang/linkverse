// Mirrors pipeline/score.py::SUBSCRIBER_TIERS — keep tier boundaries identical
// so the frontend filter matches what the backtest tiers actually measured.
export const SUBSCRIBER_TIERS: { name: string; min: number; max: number | null }[] = [
  { name: "1K-10K", min: 1_000, max: 10_000 },
  { name: "10K-50K", min: 10_000, max: 50_000 },
  { name: "50K-200K", min: 50_000, max: 200_000 },
  { name: "200K-1M", min: 200_000, max: 1_000_000 },
  { name: "1M+", min: 1_000_000, max: null },
];

export function subscriberTierOf(count: number): string | null {
  const tier = SUBSCRIBER_TIERS.find((t) => count >= t.min && (t.max === null || count < t.max));
  return tier?.name ?? null;
}
