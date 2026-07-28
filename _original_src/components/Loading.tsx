import { useLocale } from "../lib/i18n";

export function Loading({ label }: { label?: string }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center justify-center py-24 text-ink-400 text-sm gap-2 animate-fade-in-up">
      <span className="relative inline-flex w-3 h-3">
        <span className="absolute inset-0 rounded-full bg-accent animate-ping opacity-60" />
        <span className="relative inline-block w-3 h-3 rounded-full bg-accent" />
      </span>
      {label ?? t("app.loading")}
    </div>
  );
}
