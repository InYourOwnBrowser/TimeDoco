import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        faq: resolve(import.meta.dirname, 'faq/index.html'),
        blog: resolve(import.meta.dirname, 'blog/index.html'),
        blogIntro: resolve(import.meta.dirname, 'blog/introducing-timedoco/index.html'),
        blogPrivacy: resolve(import.meta.dirname, 'blog/why-client-side-privacy-matters/index.html'),
        blogToggl: resolve(import.meta.dirname, 'blog/timedoco-vs-toggl/index.html'),
        blogZeroBackend: resolve(import.meta.dirname, 'blog/how-timedoco-was-built-zero-backend/index.html'),
        blogGdpr: resolve(import.meta.dirname, 'blog/gdpr-compliance-for-freelancers/index.html'),
        privacy: resolve(import.meta.dirname, 'privacy/index.html'),
        terms: resolve(import.meta.dirname, 'terms/index.html'),
      },
    },
  },
  plugins: [
    { enforce: 'pre', ...mdx({ remarkPlugins: [remarkGfm] }) },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        navigateFallback: '/app/index.html',
        navigateFallbackAllowlist: [/^\/app\//],
      },
      manifest: {
        name: 'TimeDoco',
        short_name: 'TimeDoco',
        description: 'Privacy-first, 100% client-side Time Tracker App',
        scope: '/',
        start_url: '/app/',
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
