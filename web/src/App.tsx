import { NavLink, Route, Routes } from "react-router-dom";
import clsx from "clsx";
import MatrixPage from "./pages/MatrixPage";
import BacktestPage from "./pages/BacktestPage";
import SystemStatusPage from "./pages/SystemStatusPage";
import { useDataset } from "./lib/useDataset";
import FlywheelCounter from "./components/FlywheelCounter";
import LanguageToggle from "./components/LanguageToggle";
import { useLocale } from "./lib/i18n";

function App() {
  const { data, error } = useDataset();
  const { t } = useLocale();
  const navItems = [
    { to: "/", label: t("nav.matrix") },
    { to: "/backtest", label: t("nav.backtest") },
    { to: "/status", label: t("nav.status") },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#04073b]/90 backdrop-blur overflow-hidden">
        <div className="glimmer-aura" aria-hidden="true" />
        <div className="glimmer-particles" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>
        <div className="relative max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-8">
          <span className="flex items-center gap-2 font-semibold text-lg tracking-tight text-ink-100">
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" className="shrink-0 animate-twinkle">
              <path
                fill="url(#header-glimmer)"
                d="M24 3c1.1 7.7 2.7 12.9 5.4 15.6C32.1 21.3 37.3 22.9 45 24c-7.7 1.1-12.9 2.7-15.6 5.4C26.7 32.1 25.1 37.3 24 45c-1.1-7.7-2.7-12.9-5.4-15.6C15.9 26.7 10.7 25.1 3 24c7.7-1.1 12.9-2.7 15.6-5.4C21.3 15.9 22.9 10.7 24 3Z"
              />
              <defs>
                <radialGradient id="header-glimmer" cx="50%" cy="42%" r="65%">
                  <stop offset="0%" stopColor="#ffd9a8" />
                  <stop offset="55%" stopColor="#ff8b26" />
                  <stop offset="100%" stopColor="#cc6f1a" />
                </radialGradient>
              </defs>
            </svg>
            微光寻者 <span className="text-ink-600 font-normal text-sm">Glimmer Scout</span>
          </span>
          <span className="hidden md:inline-block text-xs tracking-wide border-l border-white/10 pl-4 glimmer-text font-medium">
            Catch Glimmer Before Dawn
          </span>
          <nav className="flex gap-1 ml-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  clsx(
                    "px-3 py-1.5 rounded-md text-sm transition-all duration-200",
                    isActive
                      ? "bg-accent/15 text-accent shadow-[0_0_12px_-2px_rgba(255,139,38,0.5)]"
                      : "text-ink-400 hover:text-ink-100 hover:bg-white/5",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          {data && (
            <div className="hidden lg:block border-l border-white/10 pl-4">
              <FlywheelCounter channelCount={data.meta.channel_count} />
            </div>
          )}
          <div className="border-l border-white/10 pl-4">
            <LanguageToggle />
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-red-500/10 text-red-300 text-sm px-6 py-2 text-center animate-fade-in-up">
          {t("app.loadError", { error })}
        </div>
      )}

      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-6 animate-fade-in-up">
        <Routes>
          <Route path="/" element={<MatrixPage />} />
          <Route path="/backtest" element={<BacktestPage />} />
          <Route path="/status" element={<SystemStatusPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
