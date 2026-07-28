import clsx from "clsx";
import type { ArchitectureLayerStatus } from "../lib/schema";
import { useLocale } from "../lib/i18n";

const STYLES: Record<ArchitectureLayerStatus, string> = {
  live: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  live_with_caveat: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  pending: "bg-gray-500/15 text-ink-400 border-gray-500/30",
};

export function StatusBadge({ status }: { status: ArchitectureLayerStatus }) {
  const { t } = useLocale();
  return (
    <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-full text-xs border", STYLES[status])}>
      {t(`statusBadge.${status}`)}
    </span>
  );
}
