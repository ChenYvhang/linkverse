import { useEffect, useState } from "react";
import { currentTheme, setTheme, type Theme } from "./theme";

/**
 * The one button the brief asked for: flips between the light "viewfinder"
 * mood and the dark "night watch" mood (see linkverse.css's file-level
 * comment for what actually differs between them). Lives in the header, next
 * to the wordmark, since it's a standing preference rather than a per-screen
 * control.
 */
export default function ThemeToggle() {
  // Read lazily rather than defaulting to "light": index.html's inline
  // script already applied the real theme before React mounted, so this
  // just has to agree with the DOM rather than guess and risk a mismatch.
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  const next = theme === "light" ? "dark" : "light";

  return (
    <button
      onClick={() => setThemeState(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="relative inline-flex items-center justify-center w-8 h-8 rounded-full border border-line
                 text-muted hover:text-ink hover:border-accent/50 transition-colors shrink-0"
    >
      {/* Both icons always render; opacity/rotation crossfades between them
          rather than swapping the SVG on click, so the icon change carries
          the app's existing motion vocabulary (a quick, deliberate reveal)
          instead of popping instantly. */}
      <svg
        viewBox="0 0 20 20"
        className={`absolute w-4 h-4 transition-all duration-300 ${
          theme === "light" ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"
        }`}
        fill="none"
      >
        <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.6" />
        <path
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          d="M10 2.5v1.8M10 15.7v1.8M17.5 10h-1.8M4.3 10H2.5M15.3 4.7l-1.27 1.27M5.97 14.03 4.7 15.3M15.3 15.3l-1.27-1.27M5.97 5.97 4.7 4.7"
        />
      </svg>
      <svg
        viewBox="0 0 20 20"
        className={`absolute w-4 h-4 transition-all duration-300 ${
          theme === "dark" ? "opacity-100 rotate-0 scale-100" : "opacity-0 rotate-90 scale-50"
        }`}
        fill="none"
      >
        <path
          fill="currentColor"
          d="M17.1 12.6A7.4 7.4 0 0 1 7.4 2.9a7.7 7.7 0 1 0 9.7 9.7Z"
        />
      </svg>
    </button>
  );
}
