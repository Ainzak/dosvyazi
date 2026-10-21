import { changeLanguage, communityOverview, composerTools, workspaceLink } from './workspace-navigation';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
const gif = Buffer.from('R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQACgAAACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7', 'base64');
function sizedGif(size: number) {
  const blocks: Buffer[] = [gif.subarray(0, -1), Buffer.from([0x21, 0xfe])]; let remaining = size - gif.length - 3;
  while (remaining > 0) { let n = Math.min(255, remaining - 1); if (remaining - n - 1 === 1) n--; if (n < 1) throw new Error('Fixture size'); blocks.push(Buffer.from([n]), Buffer.alloc(n)); remaining -= n + 1; }
  blocks.push(Buffer.from([0, 0x3b])); const result = Buffer.concat(blocks); expect(result.length).toBe(size); return result;
}

test('large GIF sticker selection stays responsive, uploads through 3 MiB and retains an ambiguous upload for safe retry', async ({ page }, info) => {
  test.setTimeout(60000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await register(page, 'Large GIF tester'); const name = 'large-' + crypto.randomUUID().slice(0, 12);
  await createPack(page, name); let posts = 0; let dropped = false;
  await page.route('**/sticker-packs/*/stickers', async route => { if (route.request().method() !== 'POST') return route.continue(); posts++; if (!dropped) { dropped = true; expect((await route.fetch()).status()).toBe(201); return route.abort(); } return route.continue(); });
  await page.getByLabel('Sticker label', { exact: true }).fill('Large wave');
  await page.getByLabel('Sticker artwork', { exact: true }).setInputFiles({ name: 'large.gif', mimeType: 'image/gif', buffer: sizedGif(1_200_000) });
  await expect(page.getByRole('button', { name: 'Add sticker', exact: true })).toBeEnabled(); expect(posts).toBe(0);
  await page.getByRole('button', { name: 'Add sticker', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach Dosvyazi.');
  await expect(page.getByLabel('Sticker label', { exact: true })).toHaveValue('Large wave');
  await page.getByRole('button', { name: 'Add sticker', exact: true }).click();
  await expect(page.locator('.sticker-list > li')).toHaveCount(3); expect(posts).toBe(2);
  await page.getByLabel('Sticker label', { exact: true }).fill('Maximum wave');
  await page.getByLabel('Sticker artwork', { exact: true }).setInputFiles({ name: 'maximum.gif', mimeType: 'image/gif', buffer: sizedGif(3 * 1024 * 1024) });
  await page.getByRole('button', { name: 'Add sticker', exact: true }).click(); await expect(page.locator('.sticker-list > li')).toHaveCount(4);
  await page.getByRole('button', { name: 'View image: maximum.gif', exact: true }).click();
  await expect.poll(() => page.getByRole('img', { name: 'Image attachment: maximum.gif', exact: true }).evaluate(e => (e as HTMLImageElement).naturalWidth)).toBe(2);
  await changeLanguage(page, 'ru'); const before = posts;
  await page.getByLabel('Изображение стикера', { exact: true }).setInputFiles({ name: 'too-large.gif', mimeType: 'image/gif', buffer: Buffer.alloc(3 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('GIF-стикер до 3 МиБ'); await expect(page.getByRole('button', { name: 'Добавить стикер', exact: true })).toBeDisabled();
  await page.getByLabel('Изображение стикера', { exact: true }).setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('PNG-стикер до 1 МиБ'); expect(posts).toBe(before); expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('sticker-limits-ru.png'), fullPage: true });
});
async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`sticker-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic sticker browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
  return (await (await page.request.get('/api/v1/account/me')).json() as { id: string }).id;
}
async function createPack(page: Page, unique: string) {
  await page.goto('/stickers'); await page.getByText('Create a sticker pack', { exact: true }).click();
  await page.getByLabel('Unique pack name', { exact: true }).fill(unique); await page.getByLabel('Pack title', { exact: true }).fill('Original animated pack');
  await page.getByRole('button', { name: 'Create pack', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Original animated pack', exact: true })).toBeVisible();
  await page.getByLabel('Sticker label', { exact: true }).fill('Wave'); await page.getByLabel('Sticker artwork', { exact: true }).setInputFiles({ name: 'wave.gif', mimeType: 'image/gif', buffer: gif });
  await page.getByRole('button', { name: 'Add sticker', exact: true }).click(); await expect(page.locator('.sticker-list')).toContainText('Wave');
  await page.getByLabel('Sticker label', { exact: true }).fill('Dot');
  await page.getByLabel('Sticker artwork', { exact: true }).setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: 'Add sticker', exact: true }).click(); await expect(page.locator('.sticker-list')).toContainText('Dot');
}
async function choose(page: Page, unique: string) {
  await page.getByRole('button', { name: 'Stickers', exact: true }).click(); await page.getByLabel('Choose a sticker pack', { exact: true }).selectOption(unique);
  await page.getByRole('button', { name: 'Use sticker: Wave', exact: true }).click(); await expect(page.getByText('Sticker ready: Wave', { exact: false })).toBeVisible();
}

test('animated packs are shared from a sent sticker, saved without artwork downloads and usable in DMs', async ({ page, browser }, info) => {
  test.setTimeout(90000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const peer = await context.newPage(); peer.on('pageerror', error => errors.push(error.message)); const peerId = await register(peer, 'Sticker peer');
    const ownerId = await register(page, 'Sticker owner'); const unique = `animated-${crypto.randomUUID().slice(0, 8)}`;
    let artworkRequests = 0; page.on('request', request => { if (request.method() === 'GET' && /\/sticker-packs\/[^/]+\/stickers\//.test(request.url())) artworkRequests++; });
    await createPack(page, unique); expect(artworkRequests).toBe(0);
    await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Sticker crew'); await page.getByRole('button', { name: 'Create community', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sticker crew', exact: true })).toBeVisible();
    await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click(); const code = await page.getByLabel('Share this invitation code').inputValue();
    await peer.goto('/communities'); await peer.getByLabel('Invitation code', { exact: true }).fill(code); await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    for (const p of [page, peer]) await workspaceLink(p, 'general');
    let messageRequests = 0; peer.on('request', request => { if (request.method() === 'GET' && /\/attachments\//.test(request.url())) messageRequests++; });
    await choose(page, unique); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(peer.getByRole('button', { name: 'View image: wave.gif', exact: true })).toBeVisible(); expect(artworkRequests).toBe(0); expect(messageRequests).toBe(0);
    await peer.getByRole('button', { name: 'View image: wave.gif', exact: true }).click(); const image = peer.getByRole('img', { name: 'Image attachment: wave.gif', exact: true });
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(2); expect(messageRequests).toBe(1);
    // Decode both actual GIF frames, rather than treating a static first frame as animation support.
    expect(await image.evaluate(async element => {
      const bytes = await (await fetch((element as HTMLImageElement).src)).arrayBuffer();
      const Constructor = Reflect.get(window, 'ImageDecoder') as new (options: { data: ArrayBuffer; type: string }) => {
        tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } }; decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>; close(): void;
      };
      const decoder = new Constructor({ data: bytes, type: 'image/gif' });
      try {
        await decoder.tracks.ready; const colors: number[][] = [];
        for (const frameIndex of [0, 1]) { const frame = await decoder.decode({ frameIndex }); const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; const context = canvas.getContext('2d')!; context.drawImage(frame.image, 0, 0); colors.push([...context.getImageData(0, 0, 1, 1).data]); frame.image.close(); }
        return decoder.tracks.selectedTrack.frameCount === 2 && colors[0]![0] !== colors[1]![0];
      } finally { decoder.close(); }
    })).toBe(true);
    await peer.getByRole('button', { name: `Sticker pack info: ${unique}`, exact: true }).click();
    await peer.getByRole('button', { name: 'Save sticker pack', exact: true }).click(); await expect(peer.getByText('Pack saved to your library.', { exact: true })).toBeVisible(); expect(messageRequests).toBe(1);
    await peer.getByRole('button', { name: 'Hide image: wave.gif', exact: true }).click(); await expect(image).toHaveCount(0);
    await peer.goto('/stickers'); await expect(peer.locator('.sticker-library')).toContainText(unique);
    await peer.getByLabel('Find pack by unique name', { exact: true }).fill(unique); await peer.getByRole('button', { name: 'Find pack', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'Original animated pack', exact: true })).toBeVisible();
    await expect(peer.getByRole('button', { name: 'Add sticker', exact: true })).toHaveCount(0);
    await peer.goto(`/profiles/${ownerId}`); await peer.getByRole('link', { name: 'Message', exact: true }).click(); await expect(peer.getByRole('region', { name: 'Direct conversation' })).toBeVisible();
    await choose(peer, unique); await peer.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await page.goto(`/profiles/${peerId}`); await page.getByRole('link', { name: 'Message', exact: true }).click();
    await page.getByRole('button', { name: 'View image: wave.gif', exact: true }).click(); await expect.poll(() => page.getByRole('img', { name: 'Image attachment: wave.gif', exact: true }).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(2);
    await page.reload(); await expect(page.getByRole('button', { name: 'View image: wave.gif', exact: true })).toBeVisible(); await expect(page.locator('.attachment-preview')).toHaveCount(0);
    expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await peer.screenshot({ path: info.outputPath('sticker-dm.png'), fullPage: true });
    await changeLanguage(peer, 'ru'); await expect(peer.getByRole('button', { name: 'Стикеры', exact: true })).toBeVisible(); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('ordinary GIF attachments stay unloaded through reload and exact retry, then hide and revoke their local URL', async ({ page }) => {
  await register(page, 'GIF owner'); await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('GIF crew'); await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await workspaceLink(page, 'general'); let requested = 0; let dropped = false;
  page.on('request', request => { if (request.method() === 'GET' && /\/attachments\//.test(request.url())) requested++; });
  await page.route('**/channels/*/attachments', async route => { if (route.request().method() !== 'POST' || dropped) return route.continue(); dropped = true; expect((await route.fetch()).status()).toBe(201); await route.abort(); });
  await composerTools(page); await page.getByLabel('Attach a file', { exact: true }).setInputFiles({ name: 'animation.gif', mimeType: 'image/gif', buffer: gif }); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Retry send', exact: true }).click(); await expect(page.locator('.message-list > li')).toHaveCount(1); expect(requested).toBe(0);
  await page.reload(); await expect(page.getByRole('button', { name: 'View image: animation.gif', exact: true })).toBeVisible(); expect(requested).toBe(0);
  await page.getByRole('button', { name: 'View image: animation.gif', exact: true }).click(); const image = page.getByRole('img', { name: 'Image attachment: animation.gif', exact: true });
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(2); expect(requested).toBe(1); const local = (await image.getAttribute('src'))!;
  await page.getByRole('button', { name: 'Hide image: animation.gif', exact: true }).click(); await expect(image).toHaveCount(0);
  expect(await page.evaluate(async url => { try { await fetch(url); return true; } catch { return false; } }, local)).toBe(false);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download file: animation.gif', exact: true }).click(); expect((await download).suggestedFilename()).toBe('animation.gif'); expect(requested).toBe(2);
});
