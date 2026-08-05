// Build config for the cloud-hosted EsquilaDB PWA (served by cloud/server.js).
// The LAN apps (tagger/monitors) keep using vite.config.js.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'esquiladb',
  publicDir: '../public',
  build: {
    outDir: '../build-cloud',
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'EsquilaDB',
        short_name: 'EsquilaDB',
        description: 'Registro de ovejas y vacunaciones',
        lang: 'es',
        theme_color: '#000000',
        background_color: '#282c34',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/logo192.png', sizes: '192x192', type: 'image/png' },
          { src: '/logo512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only. /api/* is deliberately NOT cached:
        // the app's own IndexedDB snapshot + outbox handle offline data,
        // and a second caching layer would only cause confusion.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/admin/],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
