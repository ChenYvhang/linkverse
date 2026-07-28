import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, zh, type TranslationKey } from "./dictionaries";

export type { TranslationKey };

export type Locale = "zh" | "en";

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { zh, en };
const LOCALE_KEY = "ui:locale";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem(LOCALE_KEY);
    return stored === "en" || stored === "zh" ? stored : "zh";
  });

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(LOCALE_KEY, l);
    setLocaleState(l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) =>
      interpolate(DICTIONARIES[locale][key] ?? DICTIONARIES.zh[key] ?? key, vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

// Several pipeline-generated fields (creator.vertical, vision.camera_perspective,
// vision.narrative_pace, resonance feature_breakdown keys) come from the data
// pipeline as raw Chinese labels drawn from a small, mostly-fixed set. Only
// values with a `<prefix>.*` dictionary entry get translated; anything else
// (a future category not yet translated) falls back to the raw value instead
// of leaking a literal "prefix.xxx" key string.
function rawLabel(t: LocaleContextValue["t"], prefix: string, raw: string): string {
  const key = `${prefix}.${raw}` as TranslationKey;
  return key in zh ? t(key) : raw;
}

export function verticalLabel(t: LocaleContextValue["t"], raw: string): string {
  return rawLabel(t, "vertical", raw);
}

export function perspectiveLabel(t: LocaleContextValue["t"], raw: string): string {
  return rawLabel(t, "perspective", raw);
}

export function paceLabel(t: LocaleContextValue["t"], raw: string): string {
  return rawLabel(t, "pace", raw);
}

export function productFeatureLabel(t: LocaleContextValue["t"], raw: string): string {
  return rawLabel(t, "productFeature", raw);
}

// Free-text LLM output (vision.evidence, decision.reasoning, etc.) isn't a
// fixed vocabulary — a dictionary lookup like rawLabel() can't cover it, it
// needs a real translation on disk (pipeline/translate_content.py). `en`
// missing/null means "not translated yet", not "nothing to translate", so
// this falls back to the Chinese original and flags `pending` so the caller
// can show a "showing original" note instead of silently mixing languages.
export function localizedText(
  locale: Locale,
  zh_: string,
  en_?: string | null,
): { text: string; pending: boolean } {
  if (locale !== "en") return { text: zh_, pending: false };
  if (en_) return { text: en_, pending: false };
  return { text: zh_, pending: true };
}

export function localizedList(
  locale: Locale,
  zh_: string[],
  en_?: string[] | null,
): { items: string[]; pending: boolean } {
  if (locale !== "en") return { items: zh_, pending: false };
  if (en_ && en_.length === zh_.length) return { items: en_, pending: false };
  return { items: zh_, pending: true };
}
