import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { changeLanguage } from './workspace-navigation';
import { expectReadableText } from './readability';

test('real manifest icons and network-only worker offer a private offline page and recover', async ({ page, context }, info) => {
  await page.goto('/about'); await expect(page.getByRole('heading', { name: 'Install Dosvyazi', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cdp = await context.newCDPSession(page); await cdp.send('Page.enable');
  const manifest = await cdp.send('Page.getAppManifest'); expect(manifest.errors).toEqual([]);
  expect(manifest.data).toBeTruthy(); const data = JSON.parse(manifest.data!) as { id: string; display: string; start_url: string; icons: { src: string; sizes: string }[] };
  expect(data.id).toBe('/'); expect(data.display).toBe('standalone'); expect(data.start_url).toBe('/communities');
  expect(data.icons.map(i => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
  for (const icon of data.icons) { const response = await page.request.get(icon.src); expect(response.status()).toBe(200); const bytes = await response.body(); expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); expect(bytes.readUInt32BE(16)).toBe(Number(icon.sizes.split('x')[0])); }
  const installation = await cdp.send('Page.getInstallabilityErrors'); expect(installation.installabilityErrors).toEqual([]);
  await changeLanguage(page, 'ru'); const panel = page.locator('.administration-panel'); await expectReadableText(panel); await page.screenshot({ path: info.outputPath('install-ru.png') });
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await context.setOffline(true);
  const privateFetch = await page.evaluate(async () => { try { await fetch('/api/v1/account/me'); return 'unexpected response'; } catch { return 'network failed'; } }); expect(privateFetch).toBe('network failed');
  const response = await page.goto('/messages'); expect(response?.status()).toBe(503);
  await expect(page.getByRole('heading', { name: 'Нет соединения / Offline', exact: true })).toBeVisible(); await expect(page.getByText('Messages and files are not stored for offline viewing.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('offline.png') }); await context.setOffline(false); await page.getByRole('link', { name: 'Повторить / Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Место для своей компании.', exact: true })).toBeVisible();
  await info.attach('installability.json', { body: JSON.stringify({ manifestErrors: manifest.errors, installabilityErrors: installation.installabilityErrors, icons: data.icons, cacheKeys: [] }), contentType: 'application/json' });
});

test('install prompt is deliberate and dismissal preserves browser use', async ({ page }) => {
  await page.goto('/about');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }); let calls = 0;
    Object.defineProperties(event, { prompt: { value: async () => { calls++; return { outcome: 'dismissed' }; } }, userChoice: { value: Promise.resolve({ outcome: 'dismissed' }) } });
    Object.defineProperty(window, '__installCalls', { get: () => calls }); window.dispatchEvent(event);
  });
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__installCalls'))).toBe(0);
  await page.getByRole('button', { name: 'Install app', exact: true }).click(); expect(await page.evaluate(() => Reflect.get(window, '__installCalls'))).toBe(1);
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Available now', exact: true })).toBeVisible();
});

test('a waiting worker never reloads the app until reviewed update confirmation', async ({ page, context }) => {
  const worker = await readFile('apps/web/public/sw.js', 'utf8'); let revision = 1;
  await context.route('**/sw.js', route => route.fulfill({ contentType: 'application/javascript', headers: { 'Cache-Control': 'no-store' }, body: `${worker}\n// controlled test revision ${revision}` }));
  await page.goto('/about'); await page.evaluate(async () => { await navigator.serviceWorker.ready; Reflect.set(window, '__unsentDraftProbe', 'retained'); });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  revision = 2;
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); await r!.update(); });
  await expect(page.getByText('An app update is ready. Your current window stays open until you choose to reload.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__unsentDraftProbe'))).toBe('retained');
  await page.getByRole('button', { name: 'Reload for update', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reload the app now?', exact: true }); await expect(dialog).toContainText('voice connection');
  await page.keyboard.press('Escape'); expect(await page.evaluate(() => Reflect.get(window, '__unsentDraftProbe'))).toBe('retained');
  await page.getByRole('button', { name: 'Reload for update', exact: true }).click();
  await Promise.all([page.waitForEvent('domcontentloaded'), dialog.getByRole('button', { name: 'Reload now', exact: true }).click()]);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__unsentDraftProbe'))).toBeUndefined(); await expect(page.getByRole('heading', { name: 'Install Dosvyazi', exact: true })).toBeVisible();
});

test('a worker activated by another window still permits a deliberate reload', async ({ page, context }) => {
  const worker = await readFile('apps/web/public/sw.js', 'utf8'); let revision = 1;
  await context.route('**/sw.js', route => route.fulfill({ contentType: 'application/javascript', headers: { 'Cache-Control': 'no-store' }, body: `${worker}\n// multiwindow test ${revision}` }));
  await page.goto('/about'); await page.evaluate(async () => { await navigator.serviceWorker.ready; Reflect.set(window, '__otherWindowDraft', 'retained'); });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true); revision = 2;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/'))!.update(); });
  await expect(page.getByRole('button', { name: 'Reload for update', exact: true })).toBeVisible();
  const other = await context.newPage(); await other.goto('/about');
  await other.evaluate(async () => { (await navigator.serviceWorker.getRegistration('/'))!.waiting!.postMessage('ACTIVATE_REVIEWED_UPDATE'); });
  await expect.poll(() => page.evaluate(async () => !(await navigator.serviceWorker.getRegistration('/'))!.waiting)).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, '__otherWindowDraft'))).toBe('retained');
  await page.getByRole('button', { name: 'Reload for update', exact: true }).click();
  await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('dialog').getByRole('button', { name: 'Reload now', exact: true }).click()]);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__otherWindowDraft'))).toBeUndefined(); await other.close();
});
