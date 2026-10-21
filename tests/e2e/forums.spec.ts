import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { components } from '../../apps/web/src/api/schema';
import { changeLanguage, workspaceLink, joinVoice } from './workspace-navigation';
import { expectReadableText } from './readability';
test.setTimeout(75000); test.use({ serviceWorkers: 'block' });
type Community = components['schemas']['CommunityDetails']; type Policy = components['schemas']['AccessPolicy']; type Topic = components['schemas']['ForumTopicDto'];
async function command(page: Page, path: string, data: unknown, method = 'POST') {
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  return page.request.fetch(path, { method, data, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
}
async function register(page: Page) { const r = await command(page, '/api/v1/account/register', { email: `forum-${crypto.randomUUID()}@example.test`, password: 'Synthetic forum passphrase 42', displayName: 'Forum tester' }); expect(r.status()).toBe(201); }
async function setup(page: Page, add = true) {
  await register(page); const r = await command(page, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'Forum community' }); expect(r.status()).toBe(201); const c = await r.json() as Community;
  const root = `/api/v1/communities/${c.id}`, forum = crypto.randomUUID();
  if (add) { const policy = await (await page.request.get(root + '/access')).json() as Policy; policy.channels.push({ id: forum, name: 'planning', categoryId: null, kind: 'Forum' }); expect((await command(page, root + '/access', { clientRequestId: crypto.randomUUID(), policy }, 'PUT')).status()).toBe(200); }
  return { c, root, forum, endpoint: `${root}/forums/${forum}/topics`, url: `/communities/${c.id}/forums/${forum}` };
}
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: 'New forum topic', exact: true }).click(); await page.getByLabel('Topic title', { exact: true }).fill(title); await page.getByLabel('First post', { exact: true }).fill('The first forum post'); await page.getByRole('button', { name: 'Create forum topic', exact: true }).click();
}
test('forum creation, topics and message threads have distinct navigation and keep voice connected', async ({ page }, info) => {
  const s = await setup(page, false); await page.goto(`/communities/${s.c.id}`); await page.getByRole('button', { name: 'Manage access', exact: true }).click(); await page.getByLabel('New forum', { exact: true }).fill('planning'); await page.getByRole('button', { name: 'Add forum', exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith('/access') && r.request().method() === 'PUT'); await page.getByRole('button', { name: 'Save access', exact: true }).click(); expect((await saved).status()).toBe(200);
  await joinVoice(page); await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected'); await workspaceLink(page, 'planning');
  await expect(page.getByRole('heading', { name: 'Forum topics', exact: true })).toBeVisible(); await expect(page.getByText('No forum topics match this view.', { exact: true })).toBeVisible();
  await create(page, 'Weekend activities'); await expect(page.getByRole('heading', { name: 'Weekend activities', exact: true })).toBeVisible(); const url = page.url(); const topicId = new URL(url).pathname.split('/').at(-1)!;
  await expect(page.getByRole('list', { name: 'Messages', exact: true })).toContainText('The first forum post'); await expect(page.getByText('Original message', { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Start message thread', exact: true, includeHidden: true })).toHaveCount(0);
  const composer = page.getByLabel('Message', { exact: true }); await composer.fill('A forum reply'); await page.getByRole('button', { name: 'Send message', exact: true }).click(); await expect(page.getByRole('list', { name: 'Messages', exact: true })).toContainText('A forum reply'); await expect(composer).toHaveValue(''); await expect(composer).toBeInViewport();
  await page.getByRole('button', { name: 'Manage forum topic', exact: true }).click(); await page.getByLabel('Archive forum topic (read only)', { exact: true }).check(); await page.getByRole('button', { name: 'Save topic settings', exact: true }).click(); await expect(composer).toHaveCount(0);
  await changeLanguage(page, 'ru'); await expect(page.getByText('Архивная тема форума', { exact: true })).toBeVisible(); await expectReadableText(page.locator('.forum-heading')); await page.screenshot({ path: info.outputPath('forum-topic-ru.png') });
  await changeLanguage(page, 'en'); await workspaceLink(page, 'general'); await expect(page.getByRole('link', { name: 'Message threads', exact: true })).toBeVisible(); await workspaceLink(page, 'planning'); await page.getByLabel('Show archived topics', { exact: true }).check(); await expect(page.getByRole('link', { name: 'Weekend activities', exact: true })).toHaveAttribute('href', new URL(url).pathname);
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected'); expect(topicId).toBeTruthy(); await changeLanguage(page, 'ru'); await page.screenshot({ path: info.outputPath('forum-list-ru.png') }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('lost first-post response retains the forum draft and retries one topic', async ({ page }) => {
  const s = await setup(page); await page.goto(s.url); let applied = false; const ids: string[] = [];
  await page.route('**' + s.endpoint, async route => { if (route.request().method() !== 'POST') { await route.continue(); return; } ids.push((route.request().postDataJSON() as { clientRequestId: string }).clientRequestId); if (!applied) { const response = await route.fetch(); expect(response.status()).toBe(201); applied = true; await route.abort('failed'); } else await route.continue(); });
  await create(page, 'Retry this topic'); await expect(page.locator('.forum-settings').getByRole('alert')).toContainText('Cannot reach Dosvyazi'); await expect(page.getByLabel('First post', { exact: true })).toHaveValue('The first forum post'); await page.getByRole('button', { name: 'Create forum topic', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Retry this topic', exact: true })).toBeVisible(); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  const data = await (await page.request.get(s.endpoint)).json() as components['schemas']['ForumTopicPage']; expect(data.topics).toHaveLength(1); expect(data.topics[0]!.messageCount).toBe(1);
});
test('losing forum access hides the open topic, content and composer', async ({ page, browser }) => {
  const s = await setup(page); const topic = await (await command(page, s.endpoint, { clientRequestId: crypto.randomUUID(), title: 'A private topic', content: 'Protected forum post' })).json() as Topic;
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, serviceWorkers: 'block' }); const peer = await context.newPage();
  try {
    await register(peer); const invitation = await (await command(page, s.root + '/invites', { clientRequestId: crypto.randomUUID(), lifetimeHours: 1, maxUses: 1 })).json() as { code: string }; expect((await command(peer, '/api/v1/communities/join', { code: invitation.code })).status()).toBe(200);
    await peer.goto(s.url + '/topics/' + topic.id); await expect(peer.getByRole('list', { name: 'Messages', exact: true })).toContainText('Protected forum post');
    const policy = await (await page.request.get(s.root + '/access')).json() as Policy; policy.channelRules.push({ resourceId: s.forum, roleId: s.c.id, allow: 0, deny: 1 }); expect((await command(page, s.root + '/access', { clientRequestId: crypto.randomUUID(), policy }, 'PUT')).status()).toBe(200);
    await expect(peer.getByRole('heading', { name: 'Forum topic unavailable.', exact: true })).toBeVisible({ timeout: 12000 }); await expect(peer.getByText('Protected forum post', { exact: true })).toHaveCount(0); await expect(peer.getByLabel('Message', { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
