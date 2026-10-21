import { changeLanguage, communityOverview, composerTools, messageAction, workspaceLink } from './workspace-navigation';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`usability-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic usability browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function community(page: Page) {
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Usability crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Usability crew', exact: true })).toBeVisible();
  await workspaceLink(page, 'general');
}
async function jpeg(page: Page) {
  return Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d')!; context.fillStyle = '#285e49'; context.fillRect(0, 0, 160, 90);
    return canvas.toDataURL('image/jpeg').split(',')[1]!;
  }), 'base64');
}
async function sendImage(page: Page) {
  const bytes = await jpeg(page);
  await composerTools(page); await page.getByLabel('Attach a file', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: bytes });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View image: photo.jpg', exact: true })).toBeVisible();
  return bytes;
}
async function isBlobAvailable(page: Page, url: string) {
  return page.evaluate(async address => { try { await fetch(address); return true; } catch { return false; } }, url);
}

test('Gatherings stays inside workspace navigation and a full emoji catalogue stays compact', async ({ page }, info) => {
  await register(page, 'Picker owner');
  const catalogue = Array.from({ length: 32 }, (_, n) => ({ id: crypto.randomUUID(), name: `extra_${n.toString().padStart(2, '0')}` }));
  await page.route('**/communities/*/emoji', route => route.request().method() === 'GET' ? route.fulfill({ json: catalogue }) : route.continue());
  await page.route('**/emoji/*/image', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=', 'base64') }));
  await community(page);
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  const link = page.getByRole('link', { name: 'Gatherings', exact: true });
  const button = await link.boundingBox(); const navigation = await page.locator('.workspace-sidebar').boundingBox();
  expect(button!.x).toBeGreaterThanOrEqual(navigation!.x); expect(button!.x + button!.width).toBeLessThanOrEqual(navigation!.x + navigation!.width);
  expect(button!.height).toBeGreaterThanOrEqual(44);
  if (await menu.isVisible()) await page.keyboard.press('Escape');
  await expect(page.locator('.emoji-management')).toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('Only used reactions belong here');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const row = page.getByRole('list', { name: 'Messages', exact: true }).locator('li').filter({ hasText: 'Only used reactions belong here' });
  await expect(row.getByRole('button', { name: /^Reaction / })).toHaveCount(0);
  await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await row.getByRole('button', { name: 'Choose reaction 👍', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Reaction 👍', exact: true })).toContainText('1');
  await expect(row.getByRole('button', { name: 'Reaction 😂', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Reaction 👍', exact: true }).click();
  await expect(row.getByRole('button', { name: /^Reaction / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Insert emoji', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Insert emoji extra_31', exact: true })).toBeAttached();
  expect(await page.locator('.emoji-grid').evaluate(e => e.scrollHeight > e.clientHeight && e.clientHeight <= 180)).toBe(true);
  await page.getByLabel('Find emoji', { exact: true }).fill('extra_31');
  await page.getByRole('button', { name: 'Insert emoji extra_31', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(':extra_31:');
  await expect(page.locator('.emoji-menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Insert emoji', exact: true }).click();
  await page.getByLabel('Find emoji', { exact: true }).fill('missing'); await expect(page.getByText('No matching emoji.', { exact: true })).toBeVisible();
  await page.getByLabel('Find emoji', { exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Insert emoji', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Insert emoji', exact: true }).click();
  await page.getByLabel('Find emoji', { exact: true }).fill('extra_31');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('compact-picker.png'), fullPage: true });
  await page.getByLabel('Message', { exact: true }).click(); await expect(page.locator('.emoji-menu')).toHaveCount(0);
  await workspaceLink(page, 'Gatherings'); await expect(page.getByRole('heading', { name: 'Gatherings', exact: true })).toBeVisible();
});

test('JPEG viewing is separate from saving and preview URLs are released on hide and deletion', async ({ page }, info) => {
  await register(page, 'Image owner'); await community(page); const bytes = await sendImage(page);
  let saves = 0; page.on('download', () => saves++);
  await expect(page.getByRole('img', { name: 'Image attachment: photo.jpg', exact: true })).toHaveCount(0);
  await page.route('**/attachments/*', route => route.fulfill({ status: 503, json: { title: 'Attachment storage is unavailable. Try again later.' } }));
  await page.getByRole('button', { name: 'View image: photo.jpg', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Attachment storage is unavailable.'); await page.unroute('**/attachments/*');
  await page.getByRole('button', { name: 'View image: photo.jpg', exact: true }).click();
  const image = page.getByRole('img', { name: 'Image attachment: photo.jpg', exact: true });
  await expect.poll(() => image.evaluate(e => (e as HTMLImageElement).naturalWidth)).toBe(160);
  expect(saves).toBe(0); const first = (await image.getAttribute('src'))!;
  expect(await isBlobAvailable(page, first)).toBe(true);
  const saving = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download file: photo.jpg', exact: true }).click();
  const download = await saving; const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); expect(Buffer.concat(chunks)).toEqual(bytes); expect(saves).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('image-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Hide image: photo.jpg', exact: true }).click();
  await expect(image).toHaveCount(0); expect(await isBlobAvailable(page, first)).toBe(false);
  await page.getByRole('button', { name: 'View image: photo.jpg', exact: true }).click(); await expect(image).toBeVisible();
  const second = (await image.getAttribute('src'))!;
  await messageAction(page, 'Delete message by Image owner'); await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(image).toHaveCount(0); expect(await isBlobAvailable(page, second)).toBe(false);
});

test('forged raster bytes never render active content and denied viewing keeps download separate', async ({ page }) => {
  await register(page, 'Denied image owner'); await community(page); await sendImage(page);
  await page.route('**/attachments/*', route => route.fulfill({ contentType: 'application/octet-stream', body: '<svg onload="window.previewExecuted=true" />' }));
  await page.getByRole('button', { name: 'View image: photo.jpg', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This image cannot be previewed.');
  await expect(page.getByRole('img', { name: 'Image attachment: photo.jpg', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'previewExecuted'))).toBeUndefined();
  await page.unroute('**/attachments/*');
  await page.route('**/attachments/*', route => route.fulfill({ status: 404, json: { title: 'Attachment unavailable.' } }));
  await page.getByRole('button', { name: 'View image: photo.jpg', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Attachment unavailable.');
  await expect(page.getByRole('button', { name: 'Download file: photo.jpg', exact: true })).toBeEnabled();
  await changeLanguage(page, 'ru');
  await expect(page.getByRole('button', { name: 'Посмотреть изображение: photo.jpg', exact: true })).toBeVisible();
});

test('PNG previews lose their local URL when actual community access is revoked', async ({ page, browser }, info) => {
  await register(page, 'PNG owner'); await community(page);
  const channelUrl = page.url();
  await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  await workspaceLink(page, 'general');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const peer = await context.newPage(); await register(peer, 'PNG viewer'); await peer.goto('/communities');
    await peer.getByLabel('Invitation code', { exact: true }).fill(code); await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await workspaceLink(peer, 'general');
    await composerTools(page); await page.getByLabel('Attach a file', { exact: true }).setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=', 'base64') });
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await peer.getByRole('button', { name: 'View image: pixel.png', exact: true }).click();
    const image = peer.getByRole('img', { name: 'Image attachment: pixel.png', exact: true });
    await expect.poll(() => image.evaluate(e => (e as HTMLImageElement).naturalWidth)).toBe(1);
    const localUrl = (await image.getAttribute('src'))!;
    const history = await (await peer.request.get('/api/v1' + new URL(channelUrl).pathname + '/messages')).json() as { messages: { attachment?: { id: string } }[] };
    const attachmentId = history.messages.find(m => m.attachment)?.attachment?.id;
    expect(attachmentId).toBeTruthy();
    await communityOverview(page); await page.getByRole('button', { name: 'Ban PNG viewer', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'Community unavailable.', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(image).toHaveCount(0); expect(await isBlobAvailable(peer, localUrl)).toBe(false);
    expect((await peer.request.get('/api/v1' + new URL(channelUrl).pathname + '/attachments/' + attachmentId)).status()).toBe(404);
    await peer.screenshot({ path: info.outputPath('revoked-preview.png'), fullPage: true });
  } finally { await context.close(); }
});
