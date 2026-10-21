import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { components } from '../../apps/web/src/api/schema';
import { changeLanguage } from './workspace-navigation';
import { expectReadableText } from './readability';

async function command<T>(page: Page, path: string, body: unknown, method = 'POST'): Promise<T> {
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  const response = await page.request.fetch(path, { method, data: body, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(true); return response.json() as Promise<T>;
}
async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`prepare-${crypto.randomUUID()}@example.test`); await page.getByLabel('Password', { exact: true }).fill('Synthetic preparation passphrase 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('heading', { name: `Welcome, ${name}.`, exact: true })).toBeVisible();
  return await (await page.request.get('/api/v1/account/me')).json() as { id: string };
}
async function setup(owner: Page, peer: Page) {
  await register(owner, 'Preparation owner'); const member = await register(peer, 'Preparation guest');
  const community = await command<components['schemas']['CommunityDetails']>(owner, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'Preparation crew' });
  const root = `/api/v1/communities/${community.id}/gatherings`;
  const invite = await command<{ code: string }>(owner, `/api/v1/communities/${community.id}/invites`, { clientRequestId: crypto.randomUUID(), lifetimeHours: 1, maxUses: 5 });
  await command(peer, '/api/v1/communities/join', { code: invite.code });
  const plan = { clientRequestId: crypto.randomUUID(), expectedVersion: '0', title: 'Сбор друзей', description: 'Private discussion description', game: 'Chess', localStart: new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 16), timeZoneId: 'UTC', participants: [member.id] };
  const gathering = await command<components['schemas']['GatheringDto']>(owner, root, plan);
  const url = `/communities/${community.id}/gatherings/${gathering.id}`;
  await owner.goto(url); await peer.goto(url);
  await expect(owner.getByRole('heading', { name: 'Preparation checklist', exact: true })).toBeVisible();
  await expect(peer.getByRole('heading', { name: 'Preparation checklist', exact: true })).toBeVisible();
  return { community, gathering, member, plan, path: `${root}/${gathering.id}`, url };
}

test('preparation assigns readiness, preserves uncertain retries, keeps reminders private and exports only a minimal calendar', async ({ page, browser }, info) => {
  test.setTimeout(90000); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  const peer = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    const s = await setup(page, peer); const panel = page.locator('.gathering-preparation'); const guest = peer.locator('.gathering-preparation');
    await expect(guest.getByRole('button', { name: 'Add preparation task', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Add preparation task', exact: true }).click(); await expect(panel.getByLabel('Preparation task', { exact: true })).toBeFocused();
    await panel.getByLabel('Preparation task', { exact: true }).fill('Установить игру'); await panel.getByLabel('Responsible participant', { exact: true }).selectOption(s.member.id);
    let dropped = false; await page.route('**/gatherings/*/checklist/*', async route => { if (route.request().method() !== 'PUT' || dropped) return route.continue(); dropped = true; expect((await route.fetch()).ok()).toBe(true); return route.abort(); });
    await panel.getByRole('button', { name: 'Save preparation task', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Retry checklist action', exact: true })).toBeVisible(); await panel.getByRole('button', { name: 'Retry checklist action', exact: true }).click(); await expect(panel.locator('.gathering-checklist > li')).toHaveCount(1);
    await expect(guest.getByRole('checkbox', { name: /Установить игру/ })).toBeVisible(); await guest.getByRole('checkbox', { name: /Установить игру/ }).click();
    await expect(panel.getByRole('checkbox', { name: /Установить игру/ })).toBeChecked();
    await guest.getByLabel('Remind me before the start', { exact: true }).selectOption('15'); await guest.getByRole('button', { name: 'Save my reminder', exact: true }).click();
    await expect(guest.getByRole('status')).toContainText('Reminder enabled:'); await expect(panel.getByRole('status')).toHaveText('Reminder is off.');
    await panel.locator('.gathering-calendar summary').click(); const downloadPromise = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Download calendar file', exact: true }).click();
    const download = await downloadPromise; const stream = await download.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8'); expect(text).toContain('SUMMARY:Сбор друзей'); expect(text).toContain('DTSTART:'); expect(text).not.toContain('Preparation guest'); expect(text).not.toContain('Private discussion'); expect(text).not.toContain('Установить');
    await changeLanguage(page, 'ru'); await changeLanguage(peer, 'ru'); await expect(panel.getByRole('heading', { name: 'Подготовка к сбору', exact: true })).toBeVisible();
    await expect(panel.getByLabel('Напомнить до начала', { exact: true }).locator('option:checked')).toHaveText('Без напоминания');
    await expect(panel.locator('.gathering-calendar')).toContainText(`Время организатора: ${s.gathering.localStart.replace('T', ' ')} · UTC`);
    await expectReadableText(panel); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await panel.screenshot({ path: info.outputPath('preparation-ru.png') });
    await panel.getByRole('heading', { name: 'Подготовка к сбору', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('preparation-top-ru.png') });
    await panel.getByRole('button', { name: 'Скачать файл календаря', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('preparation-bottom-ru.png') });
    await page.reload(); await expect(page.getByRole('checkbox', { name: /Установить игру/ })).toBeChecked();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('stale checklist drafts require review and a changed plan clears readiness and requires reminder opt-in again', async ({ page, browser }, info) => {
  test.setTimeout(90000); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! }); const peer = await context.newPage();
  try {
    const s = await setup(page, peer); const panel = page.locator('.gathering-preparation'); const guest = peer.locator('.gathering-preparation');
    await panel.getByRole('button', { name: 'Add preparation task', exact: true }).click(); await panel.getByLabel('Preparation task', { exact: true }).fill('Retained draft');
    await command(peer, s.path + '/comments', { clientRequestId: crypto.randomUUID(), expectedRevision: 1, text: 'Concurrent comment' });
    await panel.getByRole('button', { name: 'Save preparation task', exact: true }).click(); await expect(panel.getByRole('alert')).toContainText('Gathering changed.');
    await expect(panel.getByLabel('Preparation task', { exact: true })).toHaveValue('Retained draft'); await panel.getByRole('button', { name: 'I reviewed the latest checklist', exact: true }).click();
    await panel.getByLabel('Responsible participant', { exact: true }).selectOption(s.member.id); await panel.getByRole('button', { name: 'Save preparation task', exact: true }).click();
    await guest.getByRole('checkbox', { name: /Retained draft/ }).click(); await expect(panel.getByRole('checkbox', { name: /Retained draft/ })).toBeChecked();
    await guest.getByLabel('Remind me before the start', { exact: true }).selectOption('5'); await guest.getByRole('button', { name: 'Save my reminder', exact: true }).click(); await expect(guest.getByRole('status')).toContainText('Reminder enabled:');
    const current = await (await page.request.get(s.path)).json() as components['schemas']['GatheringDto'];
    await command(page, s.path, { ...s.plan, clientRequestId: crypto.randomUUID(), expectedVersion: current.version, game: 'Changed game' }, 'PUT');
    await expect(guest.getByRole('checkbox', { name: /Retained draft/ })).not.toBeChecked(); await expect(guest.getByRole('status')).toHaveText('Reminder is off.');
    await expect(guest.getByRole('button', { name: 'Save my reminder', exact: true })).toBeDisabled(); await guest.getByRole('button', { name: 'I reviewed the latest reminder and plan', exact: true }).click();
    await guest.getByLabel('Remind me before the start', { exact: true }).selectOption('15'); await guest.getByRole('button', { name: 'Save my reminder', exact: true }).click(); await expect(guest.getByRole('status')).toContainText('Reminder enabled:');
    const latest = await (await page.request.get(s.path)).json() as components['schemas']['GatheringDto'];
    await command(page, s.path + '/status', { clientRequestId: crypto.randomUUID(), expectedVersion: latest.version, status: 'Cancelled' }, 'PUT');
    await expect(guest.getByRole('checkbox', { name: /Retained draft/ })).toBeDisabled(); await expect(guest.getByRole('status')).toHaveText('Reminder is off.');
    await expect(guest.getByRole('button', { name: 'Save my reminder', exact: true })).toHaveCount(0);
    await changeLanguage(peer, 'ru'); await guest.screenshot({ path: info.outputPath('closed-preparation-ru.png') });
    await command(peer, `/api/v1/communities/${s.community.id}/leave`, {});
    await expect(peer.locator('.gathering-preparation')).toHaveCount(0);
  } finally { await context.close(); }
});
