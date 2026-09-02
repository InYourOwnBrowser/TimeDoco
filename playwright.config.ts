import { defineConfig } from '@playwright/test';

/**
 * End-to-end coverage for the flows that only exist in sequence.
 *
 * The unit suite calls functions; these drive the built application. Run
 * `npm run test:e2e`, which builds `dist/` first — every spec serves that
 * directory, so a stale build tests the wrong code.
 *
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE points the run at a Chromium that is already
 * on the machine, for sandboxes that ship one instead of downloading it.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
});
