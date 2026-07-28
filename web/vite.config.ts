import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this app under /glimmer-scout/, but Vercel serves it
  // from the domain root, so only apply the subpath base outside of Vercel.
  base: process.env.VERCEL ? '/' : '/glimmer-scout/',
  plugins: [react(), tailwindcss()],
})
