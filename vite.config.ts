import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifestFilename: 'manifest.webmanifest',
      includeAssets: [
        'zivifactura-app-192-v29.png',
        'zivifactura-app-v28.png',
        'zivifactura-header-v28.png',
        'zivifactura-rates-v28.png',
      ],
      manifest: {
        id: '/',
        name: 'ZiviFactura',
        short_name: 'ZiviFactura',
        description: 'Facturación, cobros, cuentas por cobrar y tasas en una sola aplicación de Zivi Dynamics C.A.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#F6FAFF',
        theme_color: '#F8FBFF',
        lang: 'es',
        categories: ['business', 'finance', 'productivity'],
        prefer_related_applications: false,
        icons: [
          {
            src: '/zivifactura-app-192-v29.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/zivifactura-app-v28.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/zivifactura-app-192-v29.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/zivifactura-app-v28.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
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
