import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// En el build para cPanel (`--mode cpanel`) agrega a dist/ el .htaccess de
// cpanel/ (rutas de la SPA, /api para Node.js, HTTPS). En Vercel no hace falta.
//
// La Content-Security-Policy del .htaccess solo deja correr los scripts en
// linea de index.html (tema y marca antes de pintar) por su hash. Se calculan
// aqui sobre el index.html ya construido y van en lugar de __CSP_SCRIPTS__,
// asi que editar esos scripts no rompe la politica.
const htaccessCpanel = () => ({
  name: 'htaccess-cpanel',
  enforce: 'post',
  generateBundle(_opciones, bundle) {
    const html = bundle['index.html']?.source
    if (typeof html !== 'string') this.error('htaccess-cpanel: no encontré index.html en el build')
    // El navegador calcula el hash con los saltos de linea ya pasados a \n:
    // una build hecha en Windows (CRLF) no coincidiria si no se normalizan.
    const hashes = [...String(html).matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(([, codigo]) => `'sha256-${createHash('sha256').update(codigo.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`)
    const plantilla = readFileSync(new URL('./cpanel/.htaccess', import.meta.url), 'utf8')
    if (!plantilla.includes('__CSP_SCRIPTS__')) this.error('htaccess-cpanel: falta __CSP_SCRIPTS__ en cpanel/.htaccess')
    const htaccess = plantilla.replaceAll('__CSP_SCRIPTS__', hashes.join(' '))
    this.emitFile({ type: 'asset', fileName: '.htaccess', source: htaccess })
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
