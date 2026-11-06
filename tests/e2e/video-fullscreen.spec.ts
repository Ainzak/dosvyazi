import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createInvitation, startScreenShare, changeLanguage, joinVoice } from './workspace-navigation';

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`fullscreen-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic fullscreen passphrase 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}

test('remote screen fullscreen preserves media and voice through native exit, fallback and publisher departure', async ({ page, browser, context }, info) => {
  test.setTimeout(120_000); await context.grantPermissions(['camera', 'microphone']);
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  });
  await register(page, 'Fullscreen sender'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Fullscreen test');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  const invitation = await createInvitation(page);
  const peerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['camera', 'microphone'] });
  try {
    const peer = await peerContext.newPage(); let joins = 0;
    peer.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/voice/join')) joins++; });
    await register(peer, 'Fullscreen receiver'); await peer.goto('/communities');
    await peer.getByLabel('Invitation code', { exact: true }).fill(invitation);
    await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await joinVoice(peer); await expect(peer.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 });
    await joinVoice(page); await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toBeEnabled({ timeout: 20_000 });
    await startScreenShare(page);
    await peer.getByRole('button', { name: 'View shared video (1)', exact: true }).click();
    const video = peer.locator('.voice-video-tile video');
    await expect.poll(() => video.evaluate(e => (e as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await video.evaluate(e => { (e as HTMLElement).dataset.fullscreenProbe = 'retained'; });
    const track = await video.evaluate(e => ((e as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]!.id);
    const open = peer.getByRole('button', { name: 'Open fullscreen', exact: true });
    const exit = peer.getByRole('button', { name: 'Exit fullscreen', exact: true });
    await open.click(); await expect.poll(() => peer.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(exit).toBeVisible();
    await peer.screenshot({ path: info.outputPath('remote-screen-fullscreen.png') });
    await exit.click(); await expect.poll(() => peer.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(open).toBeFocused();
    await open.click(); await expect.poll(() => peer.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await peer.evaluate(() => document.exitFullscreen());
    await expect(open).toBeVisible(); await expect(open).toBeFocused();
    // A denied request falls back to a viewport overlay, with trapped focus and Escape.
    await peer.evaluate(() => { HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error('Synthetic fullscreen denial')); });
    await open.click(); await expect(exit).toBeVisible();
    await expect.poll(() => peer.evaluate(() => document.fullscreenElement === null)).toBe(true);
    const bounds = await peer.getByRole('dialog').boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(peer.viewportSize()!.width - 1);
    expect(bounds!.height).toBeGreaterThanOrEqual(peer.viewportSize()!.height - 1);
    await exit.focus(); await exit.press('Shift+Tab');
    await expect(peer.getByRole('checkbox', { name: 'Receive Fullscreen sender: Screen share', exact: true })).toBeFocused();
    await exit.focus(); await exit.press('Escape'); await expect(open).toBeFocused();
    await peer.evaluate(() => { Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }); });
    await changeLanguage(peer, 'ru');
    await peer.getByRole('button', { name: 'На весь экран', exact: true }).click();
    await expect(peer.getByRole('button', { name: 'Выйти из полноэкранного режима', exact: true })).toBeVisible();
    await peer.screenshot({ path: info.outputPath('remote-screen-fallback-ru.png') });
    expect(await video.getAttribute('data-fullscreen-probe')).toBe('retained');
    expect(await video.evaluate(e => ((e as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0]!.id)).toBe(track);
    expect(joins).toBe(1);
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(peer.getByRole('dialog')).toHaveCount(0);
    await expect(peer.getByRole('region', { name: 'Управление голосом', exact: true })).toContainText('Подключено');
    expect(joins).toBe(1);
  } finally { await peerContext.close(); }
});
