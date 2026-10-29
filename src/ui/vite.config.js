import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': 'http://127.0.0.1:3210'
    }
  },
  build: {
    outDir: '../../dist/ui/web',
    emptyOutDir: true
  }
})
