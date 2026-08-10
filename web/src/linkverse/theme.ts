// Light/dark switching. Three-state contract underneath a two-state button:
// on first visit there is no stored preference, so the CSS's own
// prefers-color-scheme fallback decides (see linkverse.css) and this module
// stays out of the way entirely — no data-theme attribute, no flash of the
// wrong theme while JS loads, since the browser's OS-level preference is
// already known at first paint. Only once someone actually clicks the toggle
// does an explicit choice get written, and from then on it wins over the OS
// setting until they clear it (there is no UI for that today — matches the
// brief's "one button" ask rather than a three-way light/dark/system menu).
export type Theme = "light" | "dark";

const KEY = "linkverse.theme";

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** What's in effect right now — explicit choice if one was ever made,
 *  otherwise the OS preference. Never null: a toggle button needs to know
 *  which state it's flipping away from. */
export function currentTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return systemPrefersDark() ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable — theme still applies for this load, just won't persist */
  }
  applyTheme(theme);
}

/** Call once, before first paint if possible (see main.tsx), so a returning
 *  visitor's explicit choice is on screen immediately rather than flashing
 *  the OS-default theme first. */
export function initTheme(): Theme {
  const theme = currentTheme();
  applyTheme(theme);
  return theme;
}
