import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium'

const viewports = [
  { name: 'mobile-320', viewport: { width: 320, height: 568 }, isMobile: true },
  { name: 'mobile-360', viewport: { width: 360, height: 740 }, isMobile: true },
  { name: 'mobile-390', viewport: { width: 390, height: 844 }, isMobile: true },
  { name: 'mobile-430', viewport: { width: 430, height: 932 }, isMobile: true },
  { name: 'tablet-768', viewport: { width: 768, height: 1024 }, isMobile: false },
  { name: 'tablet-landscape-1024', viewport: { width: 1024, height: 768 }, isMobile: false },
  { name: 'laptop-1280', viewport: { width: 1280, height: 720 }, isMobile: false },
  { name: 'desktop-1440', viewport: { width: 1440, height: 900 }, isMobile: false },
  { name: 'wide-1920', viewport: { width: 1920, height: 1080 }, isMobile: false },
]

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [['list']],
  outputDir: '../.cache/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: existsSync(chromiumPath) ? chromiumPath : undefined,
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4179',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: viewports.map((item) => ({
    name: item.name,
    use: {
      ...devices['Desktop Chrome'],
      viewport: item.viewport,
      isMobile: item.isMobile,
      hasTouch: item.isMobile,
    },
  })),
})
