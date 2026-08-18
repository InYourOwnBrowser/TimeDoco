import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/TimeTag/',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        faq: resolve(import.meta.dirname, 'faq/index.html'),
        blog: resolve(import.meta.dirname, 'blog/index.html'),
        blogPrivacy: resolve(import.meta.dirname, 'blog/why-client-side-privacy-matters/index.html'),
        blogTax: resolve(import.meta.dirname, 'blog/tax-and-currency-reporting-guide/index.html'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'TimeDoco',
        short_name: 'TimeDoco',
        description: 'Privacy-first, 100% client-side Time Tracker App',
        scope: '/TimeTag/',
        start_url: '/TimeTag/app/',
        background_color: '#EEF0EC',
        theme_color: '#10161C',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  }
})
