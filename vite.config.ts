import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  plugins: [react(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src/web', filename: 'sw.ts', // Web Push に対応するため自作のService Worker
    registerType: 'prompt',
    manifest: { name: '家計簿', short_name: '家計簿', display: 'standalone', start_url: '/', theme_color: '#f5f5f7', background_color: '#f5f5f7',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }
  })],
  server: { proxy: { '/api': 'http://localhost:8787' } }
})
