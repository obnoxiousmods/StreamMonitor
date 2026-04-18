import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/static/app/',
  root: import.meta.dirname,
  build: {
    emptyOutDir: true,
    outDir: '../static/app',
  },
  plugins: [react()],
})
