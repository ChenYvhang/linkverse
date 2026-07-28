import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { LocaleProvider } from './lib/i18n'

// HashRouter (not BrowserRouter): GitHub Pages is static hosting with no
// server-side rewrite, so a deep-link refresh on /backtest would 404 under
// BrowserRouter. Hash-based routes (/#/backtest) always resolve to index.html.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </LocaleProvider>
  </StrictMode>,
)
