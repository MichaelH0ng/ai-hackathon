import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The scan API (server/index.ts) runs on 8787 and keeps the API key off the browser.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
