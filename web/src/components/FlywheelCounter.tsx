import { useFlywheelCount } from "../lib/useFlywheelCount";
import { useLocale } from "../lib/i18n";

export default function FlywheelCounter({ channelCount }: { channelCount: number }) {
  const count = useFlywheelCount();
  const { t } = useLocale();
  return (
    <span className="text-xs text-ink-400 whitespace-nowrap">
      {t("flywheel.recorded")} <span className="text-accent font-medium tabular-nums">{count}</span>{" "}
      {t("flywheel.records")} · {t("flywheel.cumulativeSample")}{" "}
      <span className="tabular-nums">{channelCount.toLocaleString()}+{count}</span> · {t("flywheel.pendingIteration")}
    </span>
  );
}
