import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { changeLanguage, composerTools, messageAction, workspaceLink } from './workspace-navigation';
import type { components } from '../../apps/web/src/api/schema';

async function command<T>(page: Page, path: string, body: unknown, method = 'POST'): Promise<T> {
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  const response = await page.request.fetch(path, { method, data: body, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(true); return response.json() as Promise<T>;
}
async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`nav-${crypto.randomUUID()}@example.test`); await page.getByLabel('Password', { exact: true }).fill('Synthetic navigation test passphrase 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('heading', { name: `Welcome, ${name}.`, exact: true })).toBeVisible();
  return await (await page.request.get('/api/v1/account/me')).json() as { id: string };
}
const row = (page: Page, text: string) => page.locator('.message-list > li').filter({ has: page.getByText(text, { exact: true }) });
async function mention(page: Page, name: string) {
  await page.getByRole('button', { name: 'Mention a member', exact: true }).click();
  await page.getByRole('region', { name: 'Choose a member to mention', exact: true }).getByRole('button', { name, exact: true }).click();
}

test('community replies and mentions retry safely; private bookmarks navigate beyond the latest history and revoke deleted sources', async ({ page, browser }, info) => {
  test.setTimeout(100000); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! }); const peer = await context.newPage();
  try {
    await register(page, 'Navigation owner'); await register(peer, 'Navigation member');
    const community = await command<components['schemas']['CommunityDetails']>(page, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'Navigation crew' });
    const invite = await command<{ code: string }>(page, `/api/v1/communities/${community.id}/invites`, { clientRequestId: crypto.randomUUID(), lifetimeHours: 24, maxUses: 10 });
    await command(peer, '/api/v1/communities/join', { code: invite.code });
    const channel = community.channels[0]!.id; const path = `/api/v1/communities/${community.id}/channels/${channel}/messages`; const url = `/communities/${community.id}/channels/${channel}`;
    const original = await command<components['schemas']['MessageDto']>(page, path, { clientMessageId: crypto.randomUUID(), content: 'Original planning agreement' });
    for (let n = 0; n < 52; n++) await command(page, path, { clientMessageId: crypto.randomUUID(), content: `Later history ${n}` });
    await peer.goto(url); await expect(row(peer, 'Original planning agreement')).toHaveCount(0);
    await peer.getByRole('button', { name: 'Load older messages', exact: true }).click();
    await messageAction(row(peer, 'Original planning agreement'), 'Reply'); await mention(peer, 'Navigation owner');
    await peer.getByRole('textbox', { name: 'Message', exact: true }).fill('Reply with a clear agreement');
    await changeLanguage(peer, 'ru'); await expect(peer.getByRole('button', { name: 'Отменить ответ', exact: true })).toBeVisible();
    expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await peer.screenshot({ path: info.outputPath('reply-draft-ru.png') }); await changeLanguage(peer, 'en');
    let dropped = false; await peer.route('**/channels/*/messages', async route => { if (route.request().method() !== 'POST' || dropped) return route.continue(); dropped = true; expect((await route.fetch()).status()).toBe(201); return route.abort(); });
    await peer.getByRole('button', { name: 'Send message', exact: true }).click(); await peer.getByRole('button', { name: 'Retry send', exact: true }).click();
    await expect(row(peer, 'Reply with a clear agreement')).toHaveCount(1); await expect(row(peer, 'Reply with a clear agreement').locator('.reply-reference')).toContainText('Original planning agreement');
    await messageAction(row(peer, 'Original planning agreement'), 'Bookmark'); const dialog = peer.getByRole('dialog', { name: 'Bookmark', exact: true });
    await dialog.getByLabel('Private note', { exact: true }).fill('Meet at 18:00'); await dialog.getByLabel('Tags, separated by commas', { exact: true }).fill('raid, plans'); await dialog.getByRole('button', { name: 'Save bookmark', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await messageAction(row(peer, 'Original planning agreement'), 'Edit bookmark');
    await expect(peer.getByRole('dialog').getByLabel('Private note', { exact: true })).toHaveValue('Meet at 18:00'); await peer.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await workspaceLink(peer, 'Bookmarks'); await peer.getByLabel('Filter by tag', { exact: true }).fill('RAID'); await peer.getByRole('button', { name: 'Search bookmarks', exact: true }).click();
    await expect(peer.locator('.personal-navigation-list > li')).toHaveCount(1); await expect(peer.locator('.personal-navigation-list')).toContainText('Meet at 18:00');
    await peer.locator('.personal-navigation-list').getByRole('link', { name: 'Navigation owner', exact: true }).click();
    await expect(peer.getByRole('region', { name: 'Referenced message', exact: true })).toContainText('Original planning agreement');
    await command(page, `${path}/${original.id}/delete`, { clientRequestId: crypto.randomUUID(), expectedVersion: original.version });
    await expect(peer.getByRole('region', { name: 'Referenced message', exact: true })).toContainText('Message source is unavailable.', { timeout: 20000 });
    await workspaceLink(peer, 'Bookmarks'); await expect(peer.locator('.personal-navigation-list')).not.toContainText('Original planning agreement'); await expect(peer.locator('.personal-navigation-list')).toContainText('Message source is unavailable.');
    await peer.getByRole('button', { name: 'Edit bookmark', exact: true }).click(); await peer.getByRole('dialog').getByRole('button', { name: 'Remove bookmark', exact: true }).click(); await expect(peer.getByText('No bookmarks found.', { exact: true })).toBeVisible();
    await page.goto('/bookmarks'); await expect(page.getByText('No bookmarks found.', { exact: true })).toBeVisible();
    await workspaceLink(page, 'Notifications'); await expect(page.locator('.personal-navigation-list > li')).toHaveCount(1); await expect(page.locator('.personal-navigation-list')).toContainText('Reply with a clear agreement'); await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click(); await expect(page.getByText('No new notifications on this page.', { exact: true })).toBeVisible(); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('DM replies, notification preferences and bookmark edits work in English and Russian without losing notes', async ({ page, browser }, info) => {
  test.setTimeout(65000); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! }); const peer = await context.newPage();
  try {
    await register(page, 'Direct navigation owner'); const recipient = await register(peer, 'Direct navigation peer');
    const conversation = await command<{ id: string }>(page, '/api/v1/direct-messages', { clientRequestId: crypto.randomUUID(), userId: recipient.id });
    const url = `/messages/${conversation.id}`; await page.goto(url); await peer.goto(url);
    await page.getByRole('textbox', { name: 'Direct message', exact: true }).fill('Direct original'); await page.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await expect(row(peer, 'Direct original')).toBeVisible(); await messageAction(row(peer, 'Direct original'), 'Reply'); await mention(peer, 'Direct navigation owner');
    await peer.getByRole('textbox', { name: 'Direct message', exact: true }).fill('Direct response'); await peer.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await expect(row(page, 'Direct response').locator('.reply-reference')).toContainText('Direct original');
    await messageAction(row(peer, 'Direct original'), 'Bookmark'); await peer.getByRole('dialog').getByLabel('Private note', { exact: true }).fill('Keep this direct agreement'); await peer.getByRole('dialog').getByRole('button', { name: 'Save bookmark', exact: true }).click(); await expect(peer.getByRole('dialog')).toHaveCount(0);
    await peer.getByText('Notification settings', { exact: true }).click(); await peer.getByLabel('Notify me about', { exact: true }).selectOption('quiet'); await expect(peer.getByLabel('Notify me about', { exact: true })).toBeEnabled();
    await page.getByRole('textbox', { name: 'Direct message', exact: true }).fill('Quiet new message'); await page.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await workspaceLink(peer, 'Notifications'); await expect(peer.getByText('No new notifications on this page.', { exact: true })).toBeVisible();
    await workspaceLink(peer, 'Bookmarks'); await peer.getByRole('button', { name: 'Edit bookmark', exact: true }).click();
    await expect(peer.getByRole('dialog').getByLabel('Private note', { exact: true })).toHaveValue('Keep this direct agreement'); await peer.getByRole('dialog').getByLabel('Tags, separated by commas', { exact: true }).fill('friends'); await peer.getByRole('dialog').getByRole('button', { name: 'Save bookmark', exact: true }).click();
    await expect(peer.locator('.personal-navigation-list')).toContainText('#friends'); await changeLanguage(peer, 'ru'); await expect(peer.getByRole('heading', { name: 'Закладки', exact: true })).toBeVisible();
    expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await peer.screenshot({ path: info.outputPath('bookmarks-ru.png'), fullPage: true });
    await messageAction(row(page, 'Direct response'), 'Reply'); await composerTools(page);
    await page.getByLabel('Attach a file', { exact: true }).setInputFiles({ name: 'agenda.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic bookmarked agenda') });
    await page.getByRole('textbox', { name: 'Direct message', exact: true }).fill('File reply context'); await page.getByRole('button', { name: 'Send direct message', exact: true }).click();
    await expect(row(page, 'File reply context').locator('.reply-reference')).toContainText('Direct response');
    await messageAction(row(page, 'File reply context'), 'Bookmark'); await page.getByRole('dialog').getByRole('button', { name: 'Save bookmark', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    let fileRequests = 0; page.on('request', r => { if (r.method() === 'GET' && r.url().includes('/attachments/')) fileRequests++; });
    await workspaceLink(page, 'Bookmarks'); await page.locator('.personal-navigation-list').getByRole('link', { name: 'Direct navigation owner', exact: true }).click();
    const focused = page.getByRole('region', { name: 'Referenced message', exact: true }); await expect(focused.getByRole('button', { name: 'Download file: agenda.txt', exact: true })).toBeVisible(); expect(fileRequests).toBe(0);
    const downloaded = page.waitForEvent('download'); await focused.getByRole('button', { name: 'Download file: agenda.txt', exact: true }).click(); expect((await downloaded).suggestedFilename()).toBe('agenda.txt'); expect(fileRequests).toBe(1);
    await workspaceLink(page, 'Notifications'); await expect(page.locator('.personal-navigation-list')).toContainText('Direct response');
  } finally { await context.close(); }
});
