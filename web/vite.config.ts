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
  server: {
    watch: {
      // public/dataset.json is the pipeline's 60MB+ full output, kept here only
      // as the input to `npm run build:data`. The app never fetches it, and
      // watching a file this large makes the dev server fall over with EBUSY
      // while the pipeline is rewriting it.
      ignored: ['**/public/dataset.json'],
    },
  },
})
