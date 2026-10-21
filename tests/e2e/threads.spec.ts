import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { components } from '../../apps/web/src/api/schema';
import { changeLanguage, messageAction, channelSearch, joinVoice, workspaceLink, openWorkspaceNavigation, closeWorkspaceNavigation } from './workspace-navigation';
import { expectReadableText } from './readability';
test.setTimeout(75000);
// Network fault injection must reach Playwright instead of the network-only worker.
// Installation/worker behavior is covered separately by installable.spec.ts.
test.use({ serviceWorkers: 'block' });
type Community = components['schemas']['CommunityDetails']; type Thread = components['schemas']['ThreadDto']; type Message = components['schemas']['MessageDto'];
async function command(page: Page, path: string, data: unknown, method = 'POST') {
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  return page.request.fetch(path, { method, data, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
}
async function register(page: Page, name: string) {
  const response = await command(page, '/api/v1/account/register', { email: `threads-${crypto.randomUUID()}@example.test`, password: 'Synthetic threads passphrase 42', displayName: name }); expect(response.status()).toBe(201); return response.json() as Promise<components['schemas']['UserProfile']>;
}
async function setup(page: Page) {
  const profile = await register(page, 'Thread owner'); const response = await command(page, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'Thread community' }); expect(response.status()).toBe(201); const c = await response.json() as Community;
  const path = `/api/v1/communities/${c.id}/channels/${c.channels[0]!.id}`; const sent = await command(page, path + '/messages', { clientMessageId: crypto.randomUUID(), content: 'Original branch root' }); expect(sent.status()).toBe(201); const root = await sent.json() as Message;
  return { c, path, root, profile, url: `/communities/${c.id}/channels/${c.channels[0]!.id}` };
}
async function send(page: Page, text: string) { await page.getByLabel('Message', { exact: true }).fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(page.getByRole('list', { name: 'Messages', exact: true }).getByText(text, { exact: true })).toBeVisible(); await expect(page.getByLabel('Message', { exact: true })).toHaveValue(''); }

test('message thread keeps its own history, search, unread and bookmark route while voice stays connected', async ({ page, browser }, info) => {
  const s = await setup(page); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] }); const peer = await context.newPage();
  try {
    const member = await register(peer, 'Thread peer'); const invite = await (await command(page, `/api/v1/communities/${s.c.id}/invites`, { clientRequestId: crypto.randomUUID(), lifetimeHours: 1, maxUses: 1 })).json() as { code: string }; expect((await command(peer, '/api/v1/communities/join', { code: invite.code })).status()).toBe(200);
    await page.goto(s.url); await joinVoice(page); const dock = page.locator('.voice-dock'); await openWorkspaceNavigation(page); await expect(dock.getByRole('status')).toContainText('Connected', { timeout: 15000 }); await closeWorkspaceNavigation(page); await workspaceLink(page, 'general');
    await messageAction(page.getByRole('list', { name: 'Messages', exact: true }).locator(`[data-message-id="${s.root.id}"]`), 'Start message thread');
    const dialog = page.getByRole('dialog', { name: 'Start a message thread', exact: true }); await expect(dialog).toBeVisible(); await dialog.getByLabel('Message thread title', { exact: true }).fill('Weekend plans'); await dialog.getByRole('button', { name: 'Create thread', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Weekend plans', exact: true })).toBeVisible(); const threadId = new URL(page.url()).pathname.split('/').at(-1)!;
    await peer.goto(s.url); const badge = peer.getByRole('link', { name: 'Thread: Weekend plans', exact: true }); await expect(badge).toBeVisible({ timeout: 12000 }); await badge.click();
    await send(page, 'threadneedle from owner'); await expect(peer.getByRole('list', { name: 'Messages', exact: true }).getByText('threadneedle from owner', { exact: true })).toBeVisible({ timeout: 15000 });
    const child = `${s.path.replace(/\/channels\/[^/]+$/, '')}/channels/${threadId}`;
    const snapshot = await (await page.request.get(child + '/messages')).json() as components['schemas']['MessageSnapshot']; const message = snapshot.messages.find(m => m.content === 'threadneedle from owner')!;
    expect((await (await peer.request.get(child + '/read-state')).json() as { unread: number }).unread).toBe(1);
    await channelSearch(peer); await peer.getByLabel('Search this channel', { exact: true }).fill('threadneedle'); await peer.getByRole('button', { name: 'Search', exact: true }).click(); await expect(peer.locator('.search-results')).toContainText('threadneedle from owner'); await peer.getByRole('button', { name: 'Close search', exact: true }).click();
    expect((await command(peer, '/api/v1/navigation/bookmarks', { clientRequestId: crypto.randomUUID(), kind: 'channel', containerId: threadId, messageId: message.id, note: 'Thread note', tags: ['plans'] }, 'PUT')).status()).toBe(200);
    await peer.goto('/bookmarks'); const sourceLink = peer.locator('.personal-navigation-list').getByRole('link', { name: 'Thread owner', exact: true }); await expect(sourceLink).toHaveAttribute('href', s.url + '/threads/' + threadId + '?message=' + message.id); await sourceLink.click(); await expect(peer.getByRole('heading', { name: 'Weekend plans', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to #general', exact: true }).click(); await expect(page.getByRole('list', { name: 'Messages', exact: true }).getByText('threadneedle from owner', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: /Thread: Weekend plans/ }).first().click(); await openWorkspaceNavigation(page); await expect(dock.getByRole('status')).toContainText('Connected'); await closeWorkspaceNavigation(page); await expect(page.getByLabel('Message', { exact: true })).toBeInViewport(); await changeLanguage(page, 'ru'); await expectReadableText(page.locator('.thread-heading')); await page.screenshot({ path: info.outputPath('thread-ru.png') }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(member.id).toBeTruthy();
  } finally { await context.close(); }
});

test('archiving, stale settings and deletion of the original preserve a read-only thread', async ({ page, browser }, info) => {
  const s = await setup(page); const created = await command(page, s.path + '/threads', { clientRequestId: crypto.randomUUID(), rootMessageId: s.root.id, title: 'Archive workflow' }); expect(created.status()).toBe(201); const thread = await created.json() as Thread;
  const url = s.url + '/threads/' + thread.id; await page.goto(url); await send(page, 'A retained thread reply');
  await page.getByRole('button', { name: 'Manage message thread', exact: true }).click(); await page.getByLabel('Message thread title', { exact: true }).fill('Local stale draft');
  expect((await command(page, s.path + '/threads/' + thread.id, { clientRequestId: crypto.randomUUID(), expectedVersion: thread.version, title: 'Remote title', archived: false }, 'PUT')).status()).toBe(200);
  await page.getByRole('button', { name: 'Save thread settings', exact: true }).click(); await expect(page.locator('.thread-settings').getByRole('alert')).toContainText('This thread changed'); await expect(page.getByLabel('Message thread title', { exact: true })).toHaveValue('Local stale draft');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Remote title', exact: true })).toBeVisible({ timeout: 12000 }); await page.getByRole('button', { name: 'Manage message thread', exact: true }).click(); await expect(page.getByLabel('Message thread title', { exact: true })).toHaveValue('Remote title');
  await page.getByLabel('Archive thread (read only)', { exact: true }).check(); await page.getByRole('button', { name: 'Save thread settings', exact: true }).click(); await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0); await expect(page.getByRole('list', { name: 'Messages', exact: true })).toContainText('A retained thread reply');
  expect((await command(page, s.path + `/messages/${s.root.id}/delete`, { clientRequestId: crypto.randomUUID(), expectedVersion: s.root.version })).status()).toBe(200);
  await page.getByText('Original message', { exact: true }).click(); await expect(page.getByText('The original message was removed. The thread remains available to channel members.', { exact: true })).toBeVisible({ timeout: 12000 });
  await page.getByRole('link', { name: 'All message threads', exact: true }).click(); await page.getByLabel('Show archived threads', { exact: true }).check(); await expect(page.getByRole('link', { name: 'Remote title', exact: true })).toBeVisible(); await changeLanguage(page, 'ru'); await expectReadableText(page.locator('.thread-directory')); await page.screenshot({ path: info.outputPath('thread-list-ru.png') });
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! }); try { const outsider = await context.newPage(); await outsider.goto(url); await expect(outsider.getByRole('heading', { name: 'Sign in to read threads.', exact: true })).toBeVisible(); } finally { await context.close(); }
});

test('lost thread creation retries the same command', async ({ page }) => {
  const s = await setup(page); await page.goto(s.url); let applied = false; const requests: string[] = [];
  await page.route('**/threads', async route => { if (route.request().method() !== 'POST') { await route.continue(); return; } requests.push((route.request().postDataJSON() as { clientRequestId: string }).clientRequestId); if (!applied) { const r = await route.fetch(); expect(r.status()).toBe(201); applied = true; await route.abort('failed'); } else await route.continue(); });
  await messageAction(page.getByRole('list', { name: 'Messages', exact: true }).locator(`[data-message-id="${s.root.id}"]`), 'Start message thread'); const dialog = page.getByRole('dialog', { name: 'Start a message thread', exact: true }); await dialog.getByLabel('Message thread title', { exact: true }).fill('Lost reply retry'); await dialog.getByRole('button', { name: 'Create thread', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Cannot reach Dosvyazi'); await dialog.getByRole('button', { name: 'Create thread', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Lost reply retry', exact: true })).toBeVisible(); expect(requests).toHaveLength(2); expect(requests[0]).toBe(requests[1]);
  const response = await page.request.get(s.path + '/threads'); expect((await response.json() as components['schemas']['ThreadPage']).threads).toHaveLength(1);
});

test('parent access revocation removes visible thread history and composer', async ({ page, browser }) => {
  const s = await setup(page); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! }); const peer = await context.newPage();
  try {
    await register(peer, 'Revoked thread member');
    const invite = await (await command(page, `/api/v1/communities/${s.c.id}/invites`, { clientRequestId: crypto.randomUUID(), lifetimeHours: 1, maxUses: 1 })).json() as { code: string };
    expect((await command(peer, '/api/v1/communities/join', { code: invite.code })).status()).toBe(200);
    const thread = await (await command(page, s.path + '/threads', { clientRequestId: crypto.randomUUID(), rootMessageId: s.root.id, title: 'Private after revocation' })).json() as Thread;
    await peer.goto(s.url + '/threads/' + thread.id); await send(peer, 'Previously accessible thread content');
    const root = `/api/v1/communities/${s.c.id}`; const policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy']; policy.roles = policy.roles.map(r => ({ ...r, grants: 0 }));
    expect((await command(page, root + '/access', { clientRequestId: crypto.randomUUID(), policy }, 'PUT')).status()).toBe(200);
    await expect(peer.getByRole('heading', { name: 'Thread unavailable.', exact: true })).toBeVisible({ timeout: 12000 });
    await expect(peer.getByText('Previously accessible thread content', { exact: true })).toHaveCount(0); await expect(peer.getByLabel('Message', { exact: true })).toHaveCount(0);
    expect((await peer.request.get(root + '/channels/' + thread.id + '/messages')).status()).toBe(404);
  } finally { await context.close(); }
});

test('thread loading and transport recovery retain the unsent draft', async ({ page }) => {
  const s = await setup(page); const thread = await (await command(page, s.path + '/threads', { clientRequestId: crypto.randomUUID(), rootMessageId: s.root.id, title: 'Transport recovery' })).json() as Thread;
  const endpoint = s.path + '/threads/' + thread.id; let release!: () => void; let failing = false; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**' + endpoint, async route => { await held; if (failing) await route.abort('failed'); else await route.continue(); });
  await page.goto(s.url + '/threads/' + thread.id); await expect(page.getByRole('status').filter({ hasText: 'Loading thread…' })).toBeVisible(); release();
  const composer = page.getByLabel('Message', { exact: true }); await composer.fill('Unsent draft survives metadata interruption');
  failing = true;
  await expect(page.locator('.thread-conversation').getByRole('alert')).toContainText('Cannot reach Dosvyazi', { timeout: 16000 }); await expect(composer).toHaveValue('Unsent draft survives metadata interruption');
  failing = false; await page.locator('.thread-conversation').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.thread-conversation').getByRole('alert')).toHaveCount(0); await expect(composer).toHaveValue('Unsent draft survives metadata interruption'); await expect(composer).toBeInViewport();
});
