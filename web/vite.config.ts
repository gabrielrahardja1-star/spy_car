/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Dev only: with VITE_TRACCAR_DEV_URL set, /api (including the WebSocket) goes to that Traccar server, so
  // `npm run dev` with VITE_DATA_SOURCE=traccar works against a remote server without CORS. The browser keeps seeing
  // one origin, which also keeps Traccar's session-origin check happy. Production uses the reverse proxy instead.
  const traccar = loadEnv(mode, process.cwd(), 'VITE_').VITE_TRACCAR_DEV_URL

  return {
    plugins: [react()],
    server: traccar ? { proxy: { '/api': { target: traccar, changeOrigin: true, ws: true } } } : undefined,
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
