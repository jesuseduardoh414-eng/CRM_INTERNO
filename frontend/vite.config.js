import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Vite 5 — sin plugin de Tailwind (v3 usa PostCSS directamente)
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Alias requerido por shadcn/ui (ver jsconfig.json)
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
