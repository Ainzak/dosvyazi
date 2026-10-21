import { changeLanguage, communityOverview, composerTools, messageAction, workspaceLink } from './workspace-navigation';
import { test, expect } from '@playwright/test';
import type { Page, Browser } from '@playwright/test';

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`message-browser-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic message browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function community(page: Page) {
  await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Text test crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Text test crew', exact: true })).toBeVisible();
  await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  await workspaceLink(page, 'general');
  await expect(page.getByRole('heading', { name: '#general' })).toBeVisible();
  return { url: page.url(), code };
}
async function member(browser: Browser, owner: Page, code: string) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: owner.viewportSize() ?? { width: 1280, height: 900 } });
  const page = await context.newPage();
  await register(page, 'Text member');
  await page.goto('/communities');
  await page.getByLabel('Invitation code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Join community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Text test crew', exact: true })).toBeVisible();
  await workspaceLink(page, 'general');
  return { context, page };
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(page.getByRole('list', { name: 'Messages', exact: true }).getByText(text, { exact: true })).toBeVisible();
}

test('attachments deliver live, download after reload and disappear after deletion', async ({ page, browser }, info) => {
  await register(page, 'File owner'); const room = await community(page); const second = await member(browser, page, room.code);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await composerTools(page); await page.getByLabel('Attach a file', { exact: true }).setInputFiles({ name: 'shared-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Verified attachment body') });
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const button = second.page.getByRole('button', { name: 'Download file: shared-notes.txt', exact: true });
    await expect(button).toBeVisible(); await second.page.reload(); await expect(button).toBeVisible();
    await second.page.route('**/attachments/*', route => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Attachment storage is unavailable. Try again later.' }) }));
    await button.click(); await expect(second.page.getByRole('alert')).toContainText('Attachment storage is unavailable.');
    await second.page.unroute('**/attachments/*');
    const received = second.page.waitForEvent('download'); await button.click(); const download = await received;
    expect(download.suggestedFilename()).toBe('shared-notes.txt');
    const stream = await download.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('Verified attachment body');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('attachments.png'), fullPage: true });
    await messageAction(page, 'Delete message by File owner');
    await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await expect(button).toHaveCount(0); expect(errors).toEqual([]);
  } finally { await second.context.close(); }
});

test('attachments retain retry identity and reject invalid selections with translated guidance', async ({ page }) => {
  await register(page, 'Retry file owner'); await community(page);
  await composerTools(page); await page.getByLabel('Attach a file', { exact: true }).setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toContainText('Choose a nonempty');
  await page.getByRole('button', { name: 'Remove selected file', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await composerTools(page); await page.getByLabel('Attach a file', { exact: true }).setInputFiles({ name: 'retry.txt', mimeType: 'text/plain', buffer: Buffer.from('Retained retry file') });
  const ids: string[] = [];
  await page.route('**/channels/*/attachments', async route => {
    const data = route.request().postDataBuffer()!.toString(); ids.push(/name="clientMessageId"\r\n\r\n([^\r]+)/.exec(data)![1]!);
    const response = await route.fetch(); if (ids.length === 1) await route.abort(); else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry send', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await expect(page.getByRole('button', { name: 'Download file: retry.txt', exact: true })).toHaveCount(1);
  await changeLanguage(page, 'ru');
  await composerTools(page);
  await expect(page.getByLabel('Прикрепить файл', { exact: true })).toBeVisible();
});

test('two users exchange live safe text and a third user cannot read it', async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await register(page, 'Text owner');
  const room = await community(page);
  const second = await member(browser, page, room.code);
  const outsider = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const hints: string[] = [];
    second.page.on('websocket', socket => socket.on('framereceived', frame => hints.push(String(frame.payload))));
    await second.page.reload();
    await expect(second.page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start the conversation.' })).toBeVisible();
    const text = '<script>alert("plain text")</script>\n' + 'W'.repeat(180);
    await send(page, text);
    await expect(second.page.getByRole('list', { name: 'Messages', exact: true }).getByText(text, { exact: true })).toBeVisible({ timeout: 5000 });
    expect(hints.some(frame => frame.includes('ChannelChanged'))).toBe(true);
    expect(hints.some(frame => frame.includes('plain text'))).toBe(false);
    await send(second.page, 'Hello from the second user.');
    await expect(page.getByText('Hello from the second user.', { exact: true })).toBeVisible({ timeout: 5000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('messages-live.png'), fullPage: true });
    await page.reload();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    const third = await outsider.newPage(); await register(third, 'Text outsider'); await third.goto(room.url);
    await expect(third.getByRole('heading', { name: 'Community unavailable.' })).toBeVisible();
    await expect(third.getByText(text, { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await second.context.close(); await outsider.close(); }
});

test('lost send response keeps a safe retry and one persistent message', async ({ page }, info) => {
  await register(page, 'Retry owner'); await community(page);
  let committed = false;
  const ids: string[] = [];
  await page.route('**/api/v1/communities/*/channels/*/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push((route.request().postDataJSON() as { clientMessageId: string }).clientMessageId);
    if (!committed) { const response = await route.fetch(); expect(response.status()).toBe(201); committed = true; await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByLabel('Message', { exact: true }).fill('Exactly one after lost response');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Cannot reach Dosvyazi' })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Exactly one after lost response');
  await page.screenshot({ path: info.outputPath('messages-send-error.png'), fullPage: true });
  await page.getByRole('button', { name: 'Retry send', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Messages', exact: true }).locator('li')).toHaveCount(1);
});

test('offline reconnect catches up missed messages and ban clears the cached timeline', async ({ page, browser }, info) => {
  test.setTimeout(60_000);
  await register(page, 'Recovery owner'); const room = await community(page);
  const second = await member(browser, page, room.code);
  try {
    await expect(second.page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
    await send(page, 'Before disconnection');
    await expect(second.page.getByText('Before disconnection', { exact: true })).toBeVisible();
    await second.context.setOffline(true);
    await expect(second.page.getByRole('status').filter({ hasText: /Offline|Reconnecting|unavailable/ })).toBeVisible({ timeout: 15_000 });
    await second.page.screenshot({ path: info.outputPath('messages-reconnecting.png'), fullPage: true });
    await send(page, 'Missed while offline one'); await send(page, 'Missed while offline two');
    await second.context.setOffline(false);
    await expect(second.page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible({ timeout: 15_000 });
    await expect(second.page.getByText('Missed while offline two', { exact: true })).toBeVisible();
    await expect(second.page.getByRole('list', { name: 'Messages', exact: true }).locator('li')).toHaveCount(3);
    const membersResponse = await page.request.get(new URL(room.url).pathname.replace('/communities/', '/api/v1/communities/').split('/channels/')[0] + '/members');
    const members = await membersResponse.json() as { userId: string; displayName: string }[];
    const target = members.find(item => item.displayName === 'Text member')!;
    const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
    const path = new URL(room.url).pathname.split('/channels/')[0];
    const ban = await page.request.put(`/api/v1${path}/members/${target.userId}/ban`, { data: { banned: true }, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
    expect(ban.status()).toBe(200);
    await expect(second.page.getByRole('heading', { name: 'Community unavailable.' })).toBeVisible({ timeout: 20_000 });
    await expect(second.page.getByText('Before disconnection', { exact: true })).toHaveCount(0);
    await expect(second.page.getByLabel('Message', { exact: true })).toHaveCount(0);
  } finally { await second.context.close(); }
});

test('history loading and failure can recover without losing the composer', async ({ page }, info) => {
  await register(page, 'History owner'); await community(page);
  await page.route('**/api/v1/communities/*/channels/*/messages', async route => { await new Promise(resolve => setTimeout(resolve, 1000)); await route.abort('failed'); });
  await page.reload();
  await expect(page.getByText('Loading messages…', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('messages-loading.png'), fullPage: true });
  // Three delayed attempts and bounded retry backoff precede the persistent error.
  await expect(page.getByRole('button', { name: 'Retry history', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Message', { exact: true }).fill('Draft retained while history recovers');
  await page.unroute('**/api/v1/communities/*/channels/*/messages');
  await page.getByRole('button', { name: 'Retry history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start the conversation.' })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Draft retained while history recovers');
});

test('older history loads without duplicates and a pending send is visible', async ({ page }, info) => {
  await register(page, 'Pagination owner'); const room = await community(page);
  const path = `/api/v1${new URL(room.url).pathname}/messages`;
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  for (let i = 1; i <= 55; i++) {
    const response = await page.request.post(path, { data: { clientMessageId: crypto.randomUUID(), content: `History message ${i}` }, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  const list = page.getByRole('list', { name: 'Messages', exact: true });
  await expect(list.locator('li')).toHaveCount(50);
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
  await expect(list.locator('li')).toHaveCount(55);
  await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toHaveCount(0);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/communities/*/channels/*/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await gate;
    await route.continue();
  });
  try {
    await page.getByLabel('Message', { exact: true }).fill('Visible while sending');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
    await expect(list.getByText('Visible while sending', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('messages-pending.png'), fullPage: true });
  } finally { release(); }
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(list.locator('li')).toHaveCount(56);
  const ids = await list.locator('li').evaluateAll(items => items.map(item => item.getAttribute('data-message-id')));
  expect(new Set(ids).size).toBe(56);
});

test('background session and community failures keep the loaded chat and draft', async ({ page }) => {
  await register(page, 'Background recovery owner'); const room = await community(page);
  await expect(page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft during background errors');
  let fail = true;
  const failure = { status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Synthetic background outage.' }) };
  await page.route('**/api/v1/account/me', route => fail ? route.fulfill(failure) : route.continue());
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Restore connection', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this draft during background errors');
  fail = false;
  await page.getByRole('button', { name: 'Restore connection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore connection', exact: true })).toHaveCount(0);
  const path = `/api/v1${new URL(room.url).pathname.split('/channels/')[0]}`;
  fail = true;
  await page.route(`**${path}`, route => fail ? route.fulfill(failure) : route.continue());
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Retry community check', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this draft during background errors');
  fail = false;
  await page.getByRole('button', { name: 'Retry community check', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry community check', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
});
