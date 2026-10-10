import { expect, test } from '@playwright/test';

test('real API status, honest empty workspace and navigation fit the viewport', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const system = await request.get('/api/v1/system');
  expect(system.status()).toBe(200);
  expect(await system.json()).toEqual({ product: 'Dosvyazi', milestone: 'Development foundation' });
  const readiness = await request.get('/health/ready');
  expect([200, 503]).toContain(readiness.status());
  await page.goto('/');
  await expect(page.getByRole('article', { name: 'Application API' })).toContainText('Connected');
  await expect(page.getByRole('article', { name: 'Database' })).toContainText(readiness.ok() ? 'Ready' : 'Unavailable');
  await expect(page.getByRole('heading', { name: 'Room for your first community.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('foundation.png'), fullPage: true });
  await page.getByRole('link', { name: 'Explore this build' }).click();
  await expect(page.getByRole('heading', { name: 'One verified step at a time.' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('This build supports shared text and voice conversations; the remaining features follow in separate milestones.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('loading is visible while the first API response is pending', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/system', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/');
    await expect(page.getByRole('article', { name: 'Application API' })).toContainText('Connecting to the application…');
    await expect(page.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('article', { name: 'Application API' })).toContainText('Connected');
});

test('a failed database check stays unavailable and can be retried', async ({ page }) => {
  let fail = true;
  await page.route('**/health/ready', route => route.fulfill({
    status: fail ? 503 : 200, json: { status: fail ? 'unhealthy' : 'healthy', checks: { database: fail ? 'unhealthy' : 'healthy' } },
  }));
  await page.goto('/');
  await expect(page.getByRole('article', { name: 'Database' })).toContainText('Unavailable');
  await expect(page.getByRole('status')).toContainText('Some services need attention.');
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled();
  fail = false;
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('article', { name: 'Database' })).toContainText('Ready');
});

test('API failure and recovery do not keep displaying cached success', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/system', route => fail ? route.abort('connectionfailed') : route.continue());
  await page.goto('/');
  const api = page.getByRole('article', { name: 'Application API' });
  await expect(api).toContainText('Unavailable');
  fail = false;
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(api).toContainText('Connected');
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled();
  fail = true;
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(api).toContainText('Connection lost');
  fail = false;
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(api).toContainText('Connected');
});

for (const invalid of [
  { name: 'missing check', status: 200, json: { status: 'healthy' } },
  { name: 'contradictory check', status: 200, json: { status: 'unhealthy', checks: { database: 'healthy' } } },
  { name: 'unavailable HTTP status', status: 503, json: { status: 'healthy', checks: { database: 'healthy' } } },
]) {
  test(`invalid readiness response (${invalid.name}) cannot appear ready`, async ({ page }) => {
    await page.route('**/health/ready', route => route.fulfill({ status: invalid.status, json: invalid.json }));
    await page.goto('/');
    await expect(page.getByRole('article', { name: 'Database' })).toContainText('Database status could not be checked.');
  });
}

test('unknown browser routes have a useful recovery link', async ({ page }) => {
  await page.goto('/missing');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'A shared space starts here.' })).toBeVisible();
});
