import clsx from "clsx";
import { useLocale } from "../lib/i18n";

export default function LanguageToggle() {
  const { locale, setLocale } = useLocale();

  return (
    <div className="flex gap-0.5 bg-white/5 rounded-md p-0.5" role="group" aria-label="Language">
      <button
        onClick={() => setLocale("zh")}
        className={clsx(
          "px-2 py-1 rounded text-xs transition-colors",
          locale === "zh" ? "bg-accent/20 text-accent" : "text-ink-400 hover:text-ink-100",
        )}
      >
        中文
      </button>
      <button
        onClick={() => setLocale("en")}
        className={clsx(
          "px-2 py-1 rounded text-xs transition-colors",
          locale === "en" ? "bg-accent/20 text-accent" : "text-ink-400 hover:text-ink-100",
        )}
      >
        EN
      </button>
    </div>
  );
}
