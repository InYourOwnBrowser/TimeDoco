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
      // 'prompt', not 'autoUpdate'. A worker that takes over on its own cleans
      // up the previous build's precache as it activates, and any tab still
      // running that build is then holding chunk names nothing serves. The
      // update installs in the background either way; PwaUpdatePrompt asks
      // before applying it. `injectRegister: null` because registration is that
      // component's job, through `virtual:pwa-register`.
      registerType: 'prompt',
      injectRegister: null,
      // The registration scope, which the plugin otherwise takes from `base`.
      // The worker has no business controlling the marketing site or the blog.
      scope: '/app/',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        navigateFallback: '/app/index.html',
        navigateFallbackAllowlist: [/^\/app\//],
        globIgnores: [
          'index.html', 'faq/**', 'blog/**', 'privacy/**', 'terms/**',
        ],
      },
      manifest: {
        name: 'TimeDoco',
        short_name: 'TimeDoco',
        description: 'Privacy-first, 100% client-side Time Tracker App',
        scope: '/app/',
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
    // Only the unit and component suites. `e2e/` is Playwright's, and its specs
    // throw if Vitest collects them.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],

    // Every suite runs twice, under two timezones.
    //
    // Nothing in the suite ran outside UTC, where a calendar day is always 24
    // hours long, local time equals UTC and a `Z`-suffixed fixture reads back
    // as the hour it was written as. Almost every day-boundary bug the app can
    // have is invisible under exactly those conditions. Pacific/Auckland is the
    // counter-case: UTC+12/+13, on the far side of the date line from UTC, with
    // a 23-hour day in September and a 25-hour day in April.
    //
    // TZ is set per project so `npm test` covers both by default. A run that is
    // green in one and red in the other is a real defect, not a configuration
    // problem.
    projects: [
      {
        extends: true,
        test: {
          name: 'utc',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          env: { TZ: 'UTC' },
        },
      },
      {
        extends: true,
        test: {
          name: 'auckland',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          env: { TZ: 'Pacific/Auckland' },
        },
      },
      // A third zone, for the one case the first two cannot show. Auckland
      // transitions at 2am and UTC never transitions, so in both of them
      // midnight exists on every date of the year. America/Santiago springs
      // forward *at* midnight, where 00:00 simply does not occur — and a day
      // whose first instant is 01:00 is what broke `calendarDayBounds` into
      // overlapping buckets. Scoped to the day-boundary and billing suites
      // rather than the whole app: this zone is about calendar arithmetic, and
      // running every component test a third time to reach it is not worth the
      // minutes.
      {
        extends: true,
        test: {
          name: 'santiago',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          env: { TZ: 'America/Santiago' },
          include: [
            'src/utils/timeUtils.test.ts',
            'src/utils/billing.test.ts',
            'src/utils/billing.invariants.test.ts',
            'src/tests/TimeTotals.consistency.test.ts',
          ],
        },
      },
    ],
  }
})
