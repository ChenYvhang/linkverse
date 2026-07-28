import { useState } from "react";
import clsx from "clsx";
import { SUBSCRIBER_TIERS } from "../lib/subscriberTiers";
import type { CreatorMarket, DataSource } from "../lib/schema";
import { useLocale, verticalLabel } from "../lib/i18n";

export interface MatrixFilters {
  verticals: string[];
  markets: string[];
  tiers: string[];
  hideRiskFlagged: boolean;
}

function TagMultiSelect({
  label,
  options,
  labelOf,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  labelOf: (v: string) => string;
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const available = options.filter((o) => !selected.includes(o));

  return (
    <div>
      <div className="text-xs font-medium text-ink-400 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {selected.map((v) => (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/25 transition-colors"
          >
            {labelOf(v)} <span className="text-[10px]">×</span>
          </button>
        ))}
        {selected.length === 0 && <span className="text-xs text-ink-600">{t("filter.all")}</span>}
      </div>
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full text-left bg-[#090d4c] border border-white/10 rounded-md text-xs px-2.5 py-1.5 text-ink-400 hover:border-white/20 transition-colors"
        >
          {t("filter.addFilter")}
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-[#111763] border border-white/15 rounded-md shadow-lg">
            {available.length === 0 && <div className="px-2.5 py-1.5 text-xs text-ink-600">{t("filter.noMoreOptions")}</div>}
            {available.map((o) => (
              <button
                key={o}
                onClick={() => {
                  onToggle(o);
                  setOpen(false);
                }}
                className="block w-full text-left px-2.5 py-1.5 text-xs text-ink-100 hover:bg-white/5"
              >
                {labelOf(o)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FilterPanel({
  verticals,
  dataSources,
  filters,
  onChange,
}: {
  verticals: string[];
  dataSources: DataSource[];
  filters: MatrixFilters;
  onChange: (next: MatrixFilters) => void;
}) {
  const { t } = useLocale();

  function toggle(key: "verticals" | "markets" | "tiers", value: string) {
    const current = filters[key];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...filters, [key]: next });
  }

  return (
    <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] flex flex-col gap-5">
      <h2 className="text-sm font-semibold text-ink-100">{t("filter.title")}</h2>

      <TagMultiSelect
        label={t("filter.vertical")}
        options={verticals}
        labelOf={(v) => verticalLabel(t, v)}
        selected={filters.verticals}
        onToggle={(v) => toggle("verticals", v)}
      />

      <TagMultiSelect
        label={t("filter.market")}
        options={["north_america_europe", "greater_china", "japan", "korea", "other", "unknown"]}
        labelOf={(v) => t(`market.${v as CreatorMarket}`)}
        selected={filters.markets}
        onToggle={(v) => toggle("markets", v)}
      />

      <TagMultiSelect
        label={t("filter.tier")}
        options={SUBSCRIBER_TIERS.map((tier) => tier.name)}
        labelOf={(v) => v}
        selected={filters.tiers}
        onToggle={(v) => toggle("tiers", v)}
      />

      <div>
        <div className="text-xs font-medium text-ink-400 mb-1.5">{t("filter.platform")}</div>
        <div className="flex flex-wrap gap-1.5">
          {dataSources.map((ds) => (
            <span
              key={ds.platform}
              className={clsx(
                "px-2 py-0.5 rounded text-xs border",
                ds.status === "connected"
                  ? "text-ink-100 border-white/20 bg-white/5"
                  : "text-ink-600 border-white/5",
              )}
            >
              {ds.platform}
              {ds.status !== "connected" && ` · ${t("filter.pending")}`}
            </span>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-ink-400 cursor-pointer">
        <input
          type="checkbox"
          checked={filters.hideRiskFlagged}
          onChange={(e) => onChange({ ...filters, hideRiskFlagged: e.target.checked })}
          className="accent-[var(--color-accent)]"
        />
        {t("filter.riskHide")}
      </label>
    </div>
  );
}
