import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // El manifest y el registro del service worker se controlan de forma
      // explícita para evitar que Chrome dependa de inyecciones automáticas.
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      includeAssets: [
        'zivifactura-app-192-v29.png',
        'zivifactura-app-v28.png',
        'zivifactura-header-v28.png',
        'zivifactura-rates-v28.png',
      ],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
    }),
  ],
  build: { sourcemap: false },
})
