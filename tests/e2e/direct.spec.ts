import { changeLanguage, composerTools } from './workspace-navigation';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`direct-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic direct browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
  return (await (await page.request.get('/api/v1/account/me')).json() as { id: string }).id;
}

test('direct recovery preserves an older history page loaded while its response is pending', async ({ page, browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  let release: () => void = () => {};
  try {
    const peer = await context.newPage(); const other = await register(peer, 'History peer');
    await register(page, 'History author'); await page.goto(`/profiles/${other}`); await page.getByRole('link', { name: 'Message', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Direct conversation' })).toBeVisible();
    const root = `/api/v1/direct-messages/${new URL(page.url()).pathname.split('/').at(-1)!}`;
    const token = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
    const headers = { 'X-CSRF-TOKEN': token.requestToken };
    for (let i = 1; i <= 55; i++) expect((await page.request.post(root + '/messages', { headers, data: { clientMessageId: crypto.randomUUID(), content: `Private history ${i}` } })).status()).toBe(201);
    const snapshot = await (await page.request.get(root + '/messages')).json() as { watermark: string };
    await page.reload(); const messages = page.getByRole('region', { name: 'Direct conversation' }).locator('.message-list > li');
    await expect(messages).toHaveCount(50);
    let captured!: () => void; const ready = new Promise<void>(resolve => { captured = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**${root}/events?after=${snapshot.watermark}`, async route => {
      const response = await route.fetch(); const body = await response.json() as { events: { message?: { content: string } }[] };
      if (body.events.some(event => event.message?.content === 'Private recovery after pagination')) { captured(); await gate; }
      await route.fulfill({ response, json: body });
    });
    expect((await page.request.post(root + '/messages', { headers, data: { clientMessageId: crypto.randomUUID(), content: 'Private recovery after pagination' } })).status()).toBe(201);
    await ready;
    await page.getByRole('button', { name: 'Load older messages', exact: true }).click(); await expect(messages).toHaveCount(55);
    release();
    await expect(page.getByRole('region', { name: 'Direct conversation' }).getByText('Private recovery after pagination', { exact: true })).toBeVisible();
    await expect(messages).toHaveCount(56);
    await expect(page.getByRole('region', { name: 'Direct conversation' }).getByText('Private history 1', { exact: true })).toHaveCount(1);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); await context.close(); }
});

test('unrelated signed-in accounts exchange live private DMs, files, voice and blocking', async ({ page, browser }, info) => {
  test.setTimeout(90000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] });
  const thirdContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const peer = await context.newPage(); peer.on('pageerror', error => errors.push(error.message)); const other = await register(peer, 'Direct peer');
    const third = await thirdContext.newPage(); await register(third, 'Direct outsider'); await third.goto('/messages');
    await register(page, 'Direct author'); await page.goto(`/profiles/${other}`);
    await page.getByRole('link', { name: 'Message', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Direct conversation' })).toBeVisible(); const conversation = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect(page.getByRole('heading', { name: 'Direct peer', exact: true })).toBeVisible();
    const directComposer = page.getByLabel('Direct message', { exact: true });
    const directBounds = await directComposer.boundingBox();
    expect(directBounds!.y + directBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.getByLabel('Direct message', { exact: true }).fill('Hello in private'); await page.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await peer.goto('/messages'); await peer.getByRole('navigation', { name: 'Conversation list', exact: true }).getByRole('link').filter({ hasText: 'Direct author' }).click();
    await expect(peer.getByRole('region', { name: 'Direct conversation' })).toContainText('Hello in private');
    await peer.getByLabel('Direct message', { exact: true }).fill('A private reply'); await peer.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Direct conversation' })).toContainText('A private reply', { timeout: 15000 });
    const root = `/api/v1/direct-messages/${conversation}`;
    expect((await third.request.get(root + '/messages')).status()).toBe(404); expect((await third.request.get(root + '/events?after=0')).status()).toBe(404);
    await third.goto(`/messages/${conversation}`); await expect(third.getByRole('heading', { name: 'Conversation is unavailable.' })).toBeVisible();
    await expect(third.locator('main')).not.toContainText('Hello in private');
    await composerTools(page); await page.getByLabel('Attach a file', { exact: true }).setInputFiles({ name: 'direct-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Private direct bytes') });
    await page.getByRole('button', { name: 'Send direct message', exact: true }).click();
    const download = peer.waitForEvent('download'); await peer.getByRole('button', { name: 'Download file: direct-note.txt', exact: true }).click(); expect((await download).suggestedFilename()).toBe('direct-note.txt');
    const data = await (await page.request.get(root + '/messages')).json() as { messages: { attachment: { id: string } | null }[] };
    const attachment = data.messages.find(message => message.attachment)?.attachment!.id;
    expect((await third.request.get(root + `/attachments/${attachment}`)).status()).toBe(404);
    await page.bringToFront(); await composerTools(page); await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
    await expect(page.getByText('Recording your microphone: 1s', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    await expect(page.getByLabel('Voice message preview', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await peer.getByRole('button', { name: 'Load voice message', exact: true }).click(); const audio = peer.getByLabel('Voice message playback', { exact: true }); await expect(audio).toBeVisible();
    await expect.poll(() => audio.evaluate(element => Number.isFinite((element as HTMLAudioElement).duration) && (element as HTMLAudioElement).duration > 0)).toBe(true);
    await peer.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await expect(peer.getByRole('region', { name: 'Direct conversation' })).toContainText('0 unread');
    await peer.getByRole('button', { name: 'Block direct contact', exact: true }).click();
    await expect(page.getByLabel('Direct message', { exact: true })).toHaveCount(0, { timeout: 15000 });
    await expect(peer.getByLabel('Direct message', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Direct conversation' })).toContainText('Hello in private');
    await peer.getByRole('button', { name: 'Unblock direct contact', exact: true }).click(); await expect(page.getByLabel('Direct message', { exact: true })).toBeEnabled({ timeout: 15000 });
    const sendBounds = await page.getByRole('button', { name: 'Send direct message', exact: true }).boundingBox();
    expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(await page.getByRole('list', { name: 'Direct messages', exact: true }).evaluate(element => element.clientHeight)).toBeGreaterThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('direct-conversation.png'), fullPage: true });
    await changeLanguage(page, 'ru'); await expect(page.getByRole('heading', { name: 'Личные сообщения', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); await thirdContext.close(); }
});

test('unconfirmed DM send retains draft and retry is unique, offline recovers and wrong target is explained', async ({ page }) => {
  const first = await register(page, 'Retry direct author');
  const otherContext = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:5174' });
  try {
    const other = await otherContext.newPage(); const peer = await register(other, 'Retry direct peer'); await page.goto('/messages');
    await page.getByLabel('Profile link or user ID').fill(`http://127.0.0.1:5174/profiles/${peer}`); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Direct conversation' })).toBeVisible();
    let dropped = false; const requests: string[] = [];
    await page.route('**/api/v1/direct-messages/*/messages', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      requests.push((route.request().postDataJSON() as { clientMessageId: string }).clientMessageId);
      if (!dropped) { dropped = true; expect((await route.fetch()).status()).toBe(201); await route.abort(); } else await route.continue();
    });
    await page.getByLabel('Direct message', { exact: true }).fill('Retained DM draft'); await page.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry send', exact: true })).toBeVisible(); await expect(page.getByLabel('Direct message', { exact: true })).toHaveValue('Retained DM draft');
    await page.getByRole('button', { name: 'Retry send', exact: true }).click(); await expect(page.getByLabel('Direct message', { exact: true })).toHaveValue('');
    await expect(page.locator('.direct-thread .message-list > li')).toHaveCount(1); expect(requests[0]).toBe(requests[1]);
    await page.context().setOffline(true); await expect(page.getByText('You are offline. New messages will appear when you reconnect.', { exact: true })).toBeVisible();
    const csrf = await (await other.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
    const root = `/api/v1/direct-messages/${new URL(page.url()).pathname.split('/').at(-1)}`;
    expect((await other.request.post(root + '/messages', { headers: { 'X-CSRF-TOKEN': csrf.requestToken }, data: { clientMessageId: crypto.randomUUID(), content: 'Sent while offline' } })).status()).toBe(201);
    await page.context().setOffline(false); await expect(page.getByLabel('Direct message', { exact: true })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Direct conversation' })).toContainText('Sent while offline', { timeout: 15000 });
    const back = page.getByRole('link', { name: 'Back to conversations', exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByLabel('Profile link or user ID').fill(first); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
    await expect(page.getByText('You cannot start a conversation with yourself.', { exact: true })).toBeVisible();
  } finally { await otherContext.close(); }
});
