import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, '.local', 'playwright-browsers');

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: path.join(root, '.local', 'artifacts', 'playwright'),
  reporter: 'list',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    // Functional suites register many synthetic users; rate enforcement is tested against PostgreSQL separately.
    { command: 'node scripts/development.mjs api', cwd: root, url: 'http://127.0.0.1:5081/health/live', env: { DOSVYAZI_API_PORT: '5081', Accounts__PermitLimit: '120' }, reuseExistingServer: false },
    { command: 'npm run dev --workspace @dosvyazi/web -- --port 5174', cwd: root, url: 'http://127.0.0.1:5174', env: { DOSVYAZI_API_TARGET: 'http://127.0.0.1:5081' }, reuseExistingServer: false },
  ],
});
