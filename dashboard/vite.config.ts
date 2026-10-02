import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/send-rcs': 'http://127.0.0.1:4001',
      '/api': 'http://127.0.0.1:4001',
    },
  },
})
