/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Para GitHub Pages en https://usuario.github.io/visitas-iess/ use: BASE=/visitas-iess/ npm run build
  base: process.env.BASE || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['iconos/*.png'],
      manifest: {
        name: 'Visitas IESS Cotocollao',
        short_name: 'Visitas IESS',
        description: 'Registro de visitas domiciliarias y entrega de medicamentos',
        lang: 'es-EC',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b4f8a',
        background_color: '#f6f7f9',
        icons: [
          { src: 'iconos/icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'iconos/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        // El OCR (motor + idioma) se guarda en el teléfono para funcionar sin señal.
        globPatterns: ['**/*.{js,css,html,png,svg,wasm,gz}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html'
      }
    })
  ],
  build: { target: 'es2020' },
  test: { environment: 'node', include: ['pruebas/**/*.test.ts'] }
});
