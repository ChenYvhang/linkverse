import { useState } from "react";
import type { Creator, CreatorMarket } from "../lib/schema";
import { removeFromCandidatePool, setBudgetCap } from "../lib/candidatePool";
import { useLocale, verticalLabel } from "../lib/i18n";

function priceMidpoint(c: Creator): number | null {
  const pr = c.decision?.price_range;
  if (!pr || pr.min === null || pr.max === null) return null;
  return (pr.min + pr.max) / 2;
}

export default function CandidatePoolPanel({
  poolIds,
  budgetCap,
  creatorsById,
  onSelect,
}: {
  poolIds: string[];
  budgetCap: number | undefined;
  creatorsById: Map<string, Creator>;
  onSelect: (channelId: string) => void;
}) {
  const { t } = useLocale();
  const [capInput, setCapInput] = useState(budgetCap !== undefined ? String(budgetCap) : "");
  const pool = poolIds.map((id) => creatorsById.get(id)).filter((c): c is Creator => c !== undefined);

  const totalSpend = pool.reduce((sum, c) => sum + (priceMidpoint(c) ?? 0), 0);
  const unpriced = pool.filter((c) => priceMidpoint(c) === null).length;
  const occupancyPct = budgetCap && budgetCap > 0 ? Math.min(100, (totalSpend / budgetCap) * 100) : null;

  const marketCounts = new Map<string, number>();
  const verticalCounts = new Map<string, number>();
  for (const c of pool) {
    marketCounts.set(c.market, (marketCounts.get(c.market) ?? 0) + 1);
    verticalCounts.set(c.vertical, (verticalCounts.get(c.vertical) ?? 0) + 1);
  }

  return (
    <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] flex flex-col gap-5">
      <h2 className="text-sm font-semibold text-ink-100">{t("pool.title", { n: pool.length })}</h2>

      <div>
        <div className="text-xs font-medium text-ink-400 mb-1.5">{t("pool.budgetTitle")}</div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs text-ink-600">{t("pool.budgetCap")}</span>
          <input
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            onBlur={() => {
              const n = Number(capInput);
              setBudgetCap(capInput === "" || Number.isNaN(n) ? undefined : n);
            }}
            placeholder={t("pool.budgetUnset")}
            className="w-28 bg-[#090d4c] border border-white/10 rounded-md text-xs px-2 py-1 text-ink-100 tabular-nums focus:outline-none focus:border-[var(--color-accent)]/50"
          />
          <span className="text-xs text-ink-600">USD</span>
        </div>
        {occupancyPct !== null ? (
          <>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: `${occupancyPct}%` }}
              />
            </div>
            <div className="text-xs text-ink-400 mt-1 tabular-nums">
              {t("pool.budgetOccupancy", {
                spend: totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                cap: budgetCap!.toLocaleString(),
                pct: occupancyPct.toFixed(0),
              })}
            </div>
          </>
        ) : (
          <div className="text-xs text-ink-600">
            {t("pool.budgetEstimate", { spend: totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 }) })}
          </div>
        )}
        {unpriced > 0 && (
          <div className="text-xs text-ink-600 mt-1">{t("pool.budgetUnpriced", { n: unpriced })}</div>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-ink-400 mb-1.5">{t("pool.marketCoverage")}</div>
        {marketCounts.size === 0 ? (
          <span className="text-xs text-ink-600">{t("pool.none")}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {[...marketCounts.entries()].map(([m, n]) => (
              <span key={m} className="px-2 py-0.5 rounded text-xs bg-white/5 border border-white/10 text-ink-400">
                {t(`market.${m as CreatorMarket}`)} × {n}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-ink-400 mb-1.5">{t("pool.verticalDistribution")}</div>
        {verticalCounts.size === 0 ? (
          <span className="text-xs text-ink-600">{t("pool.none")}</span>
        ) : (
          <div className="flex flex-col gap-1">
            {[...verticalCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([v, n]) => (
                <div key={v} className="flex items-center gap-2 text-xs">
                  <span className="text-ink-400 w-16 truncate">{verticalLabel(t, v)}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-gray-500"
                      style={{ width: `${(n / pool.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-ink-600 tabular-nums">{n}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <div className="text-xs font-medium text-ink-400 mb-1.5">{t("pool.selectedCreators")}</div>
        {pool.length === 0 ? (
          <p className="text-xs text-ink-600">{t("pool.emptyHint")}</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
            {pool.map((c) => (
              <div
                key={c.channel_id}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.04] group"
              >
                <button
                  onClick={() => onSelect(c.channel_id)}
                  className="text-xs text-ink-100 truncate text-left flex-1"
                >
                  {c.title}
                </button>
                <button
                  onClick={() => removeFromCandidatePool(c.channel_id)}
                  className="text-xs text-ink-600 hover:text-ink-100 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={t("pool.remove")}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
