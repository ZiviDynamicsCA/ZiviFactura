import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['Android >= 7', 'Chrome >= 61', 'Samsung >= 8'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  build: {
    sourcemap: false,
    target: 'es2018',
  },
})
