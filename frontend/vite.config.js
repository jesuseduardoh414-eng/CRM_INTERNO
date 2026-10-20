import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// En el build para cPanel (`--mode cpanel`) agrega a dist/ el .htaccess de
// cpanel/ (rutas de la SPA, /api para Node.js, HTTPS). En Vercel no hace falta.
const htaccessCpanel = () => ({
  name: 'htaccess-cpanel',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: '.htaccess',
      source: readFileSync(new URL('./cpanel/.htaccess', import.meta.url), 'utf8'),
    })
  },
})

// Vite 5 — sin plugin de Tailwind (v3 usa PostCSS directamente)
export default defineConfig(({ mode }) => ({
  plugins: [react(), mode === 'cpanel' && htaccessCpanel()].filter(Boolean),
  resolve: {
    // Alias requerido por shadcn/ui (ver jsconfig.json)
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
