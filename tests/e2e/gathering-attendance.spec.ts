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

test('places reserve and manual game polling work without automatic plan changes', async ({ page, browser }, info) => {
  test.setTimeout(100000); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! }); const peer = await context.newPage();
  try {
    const s = await setup(page, peer); const choices = page.locator('.gathering-choices'); const guest = peer.locator('.gathering-choices');
    await expect(choices.getByRole('heading', { name: 'Places and planning', exact: true })).toBeVisible();
    await choices.getByRole('button', { name: 'Change place limit', exact: true }).click(); await choices.getByLabel('Places including the organizer (blank for unlimited)', { exact: true }).fill('1'); await choices.getByRole('button', { name: 'Save place limit', exact: true }).click(); await expect(choices).toContainText('Place limit: 1');
    await peer.getByRole('button', { name: 'Accept gathering', exact: true }).click(); await expect(guest.getByRole('status')).toHaveText('You are in reserve. Wait for the organizer to confirm a place.');
    await expect(choices.getByRole('button', { name: 'Confirm place', exact: true })).toBeVisible();
    await choices.getByRole('button', { name: 'Change place limit', exact: true }).click(); await choices.getByLabel('Places including the organizer (blank for unlimited)', { exact: true }).fill('2'); await choices.getByRole('button', { name: 'Save place limit', exact: true }).click(); await expect(choices).toContainText('Place limit: 2');
    await expect(guest.getByRole('status')).toHaveText('You are in reserve. Wait for the organizer to confirm a place.'); await choices.getByRole('button', { name: 'Confirm place', exact: true }).click(); await expect(guest.getByRole('status')).toHaveText('Your place is confirmed.');
    await choices.getByRole('button', { name: 'Create planning poll', exact: true }).click(); await choices.getByLabel('Option 1', { exact: true }).fill('Chess'); await choices.getByLabel('Option 2', { exact: true }).fill('Checkers'); await choices.getByRole('button', { name: 'Save planning poll', exact: true }).click();
    const ballot = guest.locator('.gathering-poll'); await ballot.getByRole('checkbox', { name: /Checkers/ }).click(); await ballot.getByRole('button', { name: 'Save my vote', exact: true }).click();
    await expect(choices.locator('.gathering-poll').getByText('Votes: 1', { exact: true })).toBeVisible(); await expect(page.locator('.gathering-detail > p').filter({ hasText: 'Game:' })).toContainText('Chess');
    // The organizer can vote too; their choice does not reset another person's saved vote.
    await choices.locator('.gathering-poll').getByRole('checkbox', { name: /Checkers/ }).click(); await choices.locator('.gathering-poll').getByRole('button', { name: 'Save my vote', exact: true }).click();
    await expect(choices.locator('.gathering-poll').getByText('Votes: 2', { exact: true })).toBeVisible();
    await changeLanguage(page, 'ru'); await expectReadableText(choices); await choices.getByRole('heading', { name: 'Места и выбор плана', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('attendance-top-ru.png') });
    await choices.getByRole('button', { name: 'Утвердить вариант 2', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Утвердить этот вариант для сбора?', exact: true }); await expect(dialog).toBeVisible(); await expect(page.locator('.gathering-detail > p').filter({ hasText: 'Игра:' })).toContainText('Chess');
    await dialog.getByRole('button', { name: 'Утвердить выбранный вариант', exact: true }).click(); await expect(page.locator('.gathering-detail > p').filter({ hasText: 'Игра:' })).toContainText('Checkers');
    await expect(guest.locator('.gathering-poll')).toContainText('Poll closed'); await expect(peer.getByRole('button', { name: 'Accept gathering', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await changeLanguage(peer, 'ru'); await guest.locator('.gathering-poll').scrollIntoViewIfNeeded(); await peer.screenshot({ path: info.outputPath('poll-closed-ru.png') }); expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const fresh = await (await page.request.get(s.path)).json() as components['schemas']['GatheringDto']; expect(fresh.revision).toBe(2); expect(fresh.invites[0]!.place).toBe('None');
  } finally { await context.close(); }
});
