import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Vercel and local dev both serve this app from the domain root. Only GitHub
  // Pages serves it under a repo-name subpath, and the Pages workflow passes
  // that in explicitly as PAGES_BASE (see .github/workflows/deploy-web.yml) —
  // so the base path lives next to the deploy that needs it instead of being
  // hardcoded here, where it silently went stale across a repo rename.
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Recharts + its d3 deps are roughly two thirds of the bundle and
        // change far less often than our own code. Splitting them out means a
        // normal UI edit only invalidates the small app chunk, leaving the
        // vendor chunk cached in returning visitors' browsers.
        advancedChunks: {
          groups: [{ name: 'charts', test: /node_modules\/(recharts|d3-|victory-)/ }],
        },
      },
    },
  },
})
