import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    // The local NodeTrain server (server/index.ts) handles /api.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
