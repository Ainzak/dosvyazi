import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { components } from '../../apps/web/src/api/schema';
import { changeLanguage } from './workspace-navigation';
import { expectReadableText } from './readability';

type Configuration = components['schemas']['CommunityConfiguration'];
test.setTimeout(60000);
async function command(page: Page, path: string, data: unknown, method = 'POST') {
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  return page.request.fetch(path, { method, data, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
}
async function setup(page: Page) {
  expect((await command(page, '/api/v1/account/register', { email: `administration-${crypto.randomUUID()}@example.test`, password: 'Synthetic admin browser 42', displayName: 'Configuration owner' })).status()).toBe(201);
  const created = await command(page, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'Configuration source' }); expect(created.status()).toBe(201);
  const c = await created.json() as components['schemas']['CommunityDetails'];
  const document = await (await page.request.get(`/api/v1/communities/${c.id}/configuration`)).json() as Configuration;
  return { c, document };
}

test('saved rights explain owner access and configuration restores a reviewed isolated community', async ({ page }, info) => {
  const { c, document } = await setup(page); await page.goto(`/communities/${c.id}`);
  await page.getByRole('button', { name: 'Show access explanation', exact: true }).click();
  const rights = page.locator('.administration-panel').filter({ has: page.locator('.rights-result') });
  await expect(rights).toContainText('The owner has all supported permissions'); await rights.getByLabel('Explain access to', { exact: true }).selectOption(c.channels[0]!.id);
  await expect(rights.locator('.rights-decisions')).toContainText('Allowed');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download configuration', exact: true }).click(); expect((await download).suggestedFilename()).toBe('dosvyazi-community-v1.json');
  await changeLanguage(page, 'ru'); await rights.scrollIntoViewIfNeeded(); await expectReadableText(rights); await page.screenshot({ path: info.outputPath('rights-ru.png') });
  await page.goto('/communities'); await page.getByRole('button', { name: 'Выбрать файл настроек', exact: true }).click();
  await page.getByLabel('Файл настроек (JSON, до 256 КиБ)', { exact: true }).setInputFiles({ name: 'configuration.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole('heading', { name: 'Проверьте настройки перед созданием', exact: true })).toBeVisible();
  await page.getByLabel('Название нового сообщества', { exact: true }).fill('Independent copy');
  await page.screenshot({ path: info.outputPath('configuration-review-ru.png') });
  await page.getByRole('button', { name: 'Создать отдельное сообщество', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Independent copy'); await dialog.getByRole('button', { name: 'Создать отдельное сообщество', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Independent copy', exact: true })).toBeVisible();
  const copied = new URL(page.url()).pathname.split('/')[2]!; expect(copied).not.toBe(c.id);
  const details = await (await page.request.get(`/api/v1/communities/${copied}`)).json() as components['schemas']['CommunityDetails']; expect(details.memberCount).toBe(1); expect(details.channels[0]!.id).not.toBe(c.channels[0]!.id);
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('invalid configuration stays unimportable and a lost successful restore retries exactly once', async ({ page }) => {
  const { document } = await setup(page); await page.goto('/communities'); await page.getByRole('button', { name: 'Choose configuration file', exact: true }).click();
  const file = page.getByLabel('Configuration file (JSON, up to 256 KiB)', { exact: true });
  await file.setInputFiles({ name: 'unknown.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...document, members: [] })) });
  await expect(page.getByRole('alert')).toContainText('Invalid configuration file'); await expect(page.getByRole('button', { name: 'Create separate community', exact: true })).toHaveCount(0);
  await file.setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(256 * 1024 + 1) }); await expect(page.getByRole('alert')).toHaveText('Use a JSON configuration file up to 256 KiB.');
  await file.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) }); await page.getByLabel('New community name', { exact: true }).fill('Recovered clone');
  let committed = false; const ids: string[] = [];
  await page.route('**/api/v1/communities/configuration/restore', async route => {
    ids.push((route.request().postDataJSON() as { clientRequestId: string }).clientRequestId);
    if (!committed) { const result = await route.fetch(); expect(result.status()).toBe(201); committed = true; await route.abort('failed'); }
    else await route.continue();
  });
  const create = async () => { await page.getByRole('button', { name: 'Create separate community', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Create separate community', exact: true }).click(); };
  await create(); await expect(page.getByRole('alert')).toContainText('Cannot reach Dosvyazi'); await expect(page.getByLabel('New community name', { exact: true })).toHaveValue('Recovered clone'); await create();
  await expect(page.getByRole('heading', { name: 'Recovered clone', exact: true })).toBeVisible(); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  const list = await (await page.request.get('/api/v1/communities')).json() as components['schemas']['CommunitySummary'][]; expect(list.filter(c => c.name === 'Recovered clone')).toHaveLength(1);
});

test('revoking management removes another member explanation and hidden resource details', async ({ page, browser }) => {
  const { c } = await setup(page); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! }); const member = await context.newPage();
  try {
    const actor = await command(member, '/api/v1/account/register', { email: `rights-${crypto.randomUUID()}@example.test`, password: 'Synthetic rights passphrase 42', displayName: 'Rights manager' }); expect(actor.status()).toBe(201); const person = await actor.json() as { id: string };
    const root = `/api/v1/communities/${c.id}`; const invite = await (await command(page, root + '/invites', { clientRequestId: crypto.randomUUID(), lifetimeHours: 1, maxUses: 1 })).json() as { code: string };
    expect((await command(member, '/api/v1/communities/join', { code: invite.code })).status()).toBe(200);
    let policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy']; const role = crypto.randomUUID();
    policy.roles.push({ id: role, name: 'delegated', rank: 5, grants: 96 }); policy.members.push({ userId: person.id, roleIds: [role] });
    expect((await command(page, root + '/access', { clientRequestId: crypto.randomUUID(), policy }, 'PUT')).status()).toBe(200);
    await member.goto(`/communities/${c.id}`); await member.getByRole('button', { name: 'Show access explanation', exact: true }).click();
    await member.getByLabel('Explain access for', { exact: true }).selectOption(c.ownerId);
    const ownerText = member.getByText('The owner has all supported permissions, including access to private resources.', { exact: true }); await expect(ownerText).toBeVisible();
    policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy']; policy.roles = policy.roles.map(r => r.id === role ? { ...r, grants: 0 } : r);
    expect((await command(page, root + '/access', { clientRequestId: crypto.randomUUID(), policy }, 'PUT')).status()).toBe(200);
    await expect(member.getByLabel('Explain access for', { exact: true })).toHaveCount(0, { timeout: 12000 }); await expect(ownerText).toHaveCount(0);
    expect((await member.request.get(root + `/rights?kind=voice&userId=${c.ownerId}`)).status()).toBe(403);
    // Remove actor View while keeping membership. The chosen resource and old explanation disappear.
    policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy']; policy.roles = policy.roles.map(r => r.id === c.id ? { ...r, grants: 0 } : r);
    expect((await command(page, root + '/access', { clientRequestId: crypto.randomUUID(), policy }, 'PUT')).status()).toBe(200);
    await expect(member.getByText('Choose another accessible channel.', { exact: true })).toBeVisible({ timeout: 12000 }); await expect(member.locator('.rights-result')).toHaveCount(0);
  } finally { await context.close(); }
});
