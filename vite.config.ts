import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The scan API (server/index.ts) runs on 8787 and keeps the API key off the browser.
    // 127.0.0.1 (not "localhost") because the API listens on IPv4 loopback only.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
