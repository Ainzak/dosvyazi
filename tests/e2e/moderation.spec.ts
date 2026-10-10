import { test, expect } from '@playwright/test';
import type { Page, Browser } from '@playwright/test';
import type { components } from '../../apps/web/src/api/schema';

test.setTimeout(65000);
async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`moderation-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic moderation browser 42'); await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function create(page: Page) {
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Moderation crew'); await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Moderation crew', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue(); await page.getByRole('link', { name: 'general', exact: true }).click(); await expect(page.getByRole('heading', { name: '#general' })).toBeVisible();
  return { code, url: page.url(), api: `/api/v1${new URL(page.url()).pathname}` };
}
async function join(browser: Browser, owner: Page, code: string) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: owner.viewportSize()!, permissions: ['microphone'] }); const page = await context.newPage();
  await register(page, 'Moderation member'); await page.goto('/communities'); await page.getByLabel('Invitation code', { exact: true }).fill(code); await page.getByRole('button', { name: 'Join community', exact: true }).click();
  await page.getByRole('link', { name: 'general', exact: true }).click(); await expect(page.getByRole('heading', { name: '#general' })).toBeVisible(); return { context, page };
}
async function headers(page: Page) { const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string }; return { 'X-CSRF-TOKEN': csrf.requestToken }; }

test('edit conflicts retain drafts; deletion catches up after reconnect and appears in audit', async ({ page, browser }, info) => {
  await register(page, 'Moderation owner'); const room = await create(page); const peer = await join(browser, page, room.code);
  try {
    await peer.page.getByLabel('Message', { exact: true }).fill('Original moderation text'); await peer.page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText('Original moderation text', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit message by Moderation member', exact: true })).toHaveCount(0);
    await peer.page.getByRole('button', { name: 'Edit message by Moderation member', exact: true }).click(); await peer.page.getByLabel('Edit message text', { exact: true }).fill('First edited message');
    await peer.page.getByRole('button', { name: 'Save message', exact: true }).click(); await expect(page.getByText('First edited message', { exact: true })).toBeVisible();
    await peer.page.getByRole('button', { name: 'Edit message by Moderation member', exact: true }).click(); await peer.page.getByLabel('Edit message text', { exact: true }).fill('Retained stale draft');
    const snapshot = await (await peer.page.request.get(room.api + '/messages')).json() as components['schemas']['MessageSnapshot']; const message = snapshot.messages[0]!;
    const concurrent = await peer.page.request.put(room.api + `/messages/${message.id}`, { headers: await headers(peer.page), data: { clientRequestId: crypto.randomUUID(), expectedVersion: message.version, content: 'Concurrent current message' } }); expect(concurrent.status()).toBe(200);
    await expect(page.getByText('Concurrent current message', { exact: true })).toBeVisible();
    await peer.page.getByRole('button', { name: 'Save message', exact: true }).click(); await expect(peer.page.getByRole('alert')).toContainText('Message changed');
    await expect(peer.page.getByLabel('Edit message text', { exact: true })).toHaveValue('Retained stale draft');
    await peer.page.getByRole('button', { name: 'Cancel change', exact: true }).click();
    await peer.context.setOffline(true); await expect(peer.page.getByText('Offline.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete message by Moderation member', exact: true }).click(); await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await expect(page.getByText('Concurrent current message', { exact: true })).toHaveCount(0);
    await peer.context.setOffline(false); await expect(peer.page.getByText('Concurrent current message', { exact: true })).toHaveCount(0);
    await expect(peer.page.getByRole('heading', { name: 'Start the conversation.' })).toBeVisible();
    await page.getByRole('button', { name: 'View audit', exact: true }).click(); await expect(page.getByRole('list', { name: 'Moderation actions' })).toContainText('message.deleted');
    await expect(page.getByRole('list', { name: 'Moderation actions' })).not.toContainText('Concurrent current message'); await page.screenshot({ path: info.outputPath('moderation-audit.png'), fullPage: true });
  } finally { await peer.context.close(); }
});

test('an older history response cannot resurrect a message deleted while pagination was pending', async ({ page }, info) => {
  await register(page, 'Pagination moderator'); const room = await create(page); const csrf = await headers(page); const messages: components['schemas']['MessageDto'][] = [];
  for (let i = 1; i <= 55; i++) {
    const response = await page.request.post(room.api + '/messages', { headers: csrf, data: { clientMessageId: crypto.randomUUID(), content: `Race history ${i}` } }); expect(response.status()).toBe(201); messages.push(await response.json() as components['schemas']['MessageDto']);
  }
  await page.reload(); await expect(page.getByRole('list', { name: 'Messages', exact: true }).locator('li')).toHaveCount(50);
  let release!: () => void; let captured!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { captured = resolve; });
  await page.route('**/messages?before=*', async route => { const response = await route.fetch(); const body = await response.body(); captured(); await blocked; await route.fulfill({ response, body }); });
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click(); await ready;
  for (const message of [messages[0]!, messages[54]!]) { const response = await page.request.post(room.api + `/messages/${message.id}/delete`, { headers: csrf, data: { clientRequestId: crypto.randomUUID(), expectedVersion: '1' } }); expect(response.status()).toBe(200); }
  await expect(page.getByRole('list', { name: 'Messages', exact: true }).getByText('Race history 55', { exact: true })).toHaveCount(0);
  release(); await expect(page.getByRole('button', { name: 'Load older messages', exact: true })).toBeEnabled(); await page.unroute('**/messages?before=*');
  await expect(page.getByRole('list', { name: 'Messages', exact: true }).getByText('Race history 1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load older messages', exact: true }).click(); await expect(page.getByRole('list', { name: 'Messages', exact: true }).locator('li')).toHaveCount(53);
  await expect(page.getByRole('list', { name: 'Messages', exact: true }).getByText('Race history 1', { exact: true })).toHaveCount(0); await page.screenshot({ path: info.outputPath('moderation-history-race.png'), fullPage: true });
});

test('delegated access management preserves stale drafts and rejects changing its own rank', async ({ page, browser }, info) => {
  await register(page, 'Hierarchy owner'); const room = await create(page); const peer = await join(browser, page, room.code);
  try {
    const root = room.api.split('/channels/')[0]!; const policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy'];
    const member = await (await peer.page.request.get('/api/v1/account/me')).json() as { id: string }; const role = crypto.randomUUID();
    policy.roles.push({ id: role, name: 'Manager', grants: 6147 | 32 | 64 | 128, rank: 50 }); policy.members.push({ userId: member.id, roleIds: [role] });
    expect((await page.request.put(root + '/access', { headers: await headers(page), data: { clientRequestId: crypto.randomUUID(), policy } })).status()).toBe(200);
    await expect(peer.page.getByRole('button', { name: 'Manage access', exact: true })).toBeVisible({ timeout: 12000 }); await peer.page.getByRole('button', { name: 'Manage access', exact: true }).click();
    await peer.page.getByLabel('Selected role', { exact: true }).selectOption({ label: 'Manager' }); await peer.page.getByLabel('Role rank', { exact: true }).fill('49'); await peer.page.getByRole('button', { name: 'Save access', exact: true }).click();
    await expect(peer.page.getByRole('alert')).toContainText('equal/higher-ranked'); await expect(peer.page.getByLabel('Role rank', { exact: true })).toHaveValue('49');
    await peer.page.getByRole('button', { name: 'Reload access', exact: true }).click(); await expect(peer.page.getByLabel('Selected role', { exact: true })).toHaveValue(root.split('/').at(-1)!);
    await peer.page.getByLabel('New category', { exact: true }).fill('Retained category draft'); await peer.page.getByRole('button', { name: 'Add category', exact: true }).click();
    const updated = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy']; updated.categories.push({ id: crypto.randomUUID(), name: 'Concurrent category' });
    expect((await page.request.put(root + '/access', { headers: await headers(page), data: { clientRequestId: crypto.randomUUID(), policy: updated } })).status()).toBe(200);
    await peer.page.getByRole('button', { name: 'Save access', exact: true }).click(); await expect(peer.page.getByRole('alert')).toContainText('Access changed');
    await expect(peer.page.getByLabel('Category for general').locator('option').filter({ hasText: 'Retained category draft' })).toHaveCount(1);
    await peer.page.screenshot({ path: info.outputPath('access-stale-draft.png'), fullPage: true });
  } finally { await peer.context.close(); }
});
