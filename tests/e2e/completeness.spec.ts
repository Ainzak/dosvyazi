import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`complete-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic completeness browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function community(page: Page) {
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Complete crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Complete crew', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  await page.getByRole('link', { name: 'general', exact: true }).click(); return code;
}
test('M5 reactions, search and explicit read state survive live updates and reload', async ({ page, browser }, info) => {
  test.setTimeout(60_000);
  await register(page, 'Complete owner'); const code = await community(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const member = await context.newPage(); await register(member, 'Complete member'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await member.getByRole('link', { name: 'general', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('Hello banana Привет команда'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const row = member.getByRole('list', { name: 'Messages', exact: true }).locator('li').filter({ hasText: 'Hello banana' }); await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Reaction 👍', exact: true })).toHaveCount(0);
    await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
    await row.getByRole('button', { name: 'Choose reaction 👍', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Reaction 👍', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const ownerRow = page.getByRole('list', { name: 'Messages', exact: true }).locator('li').filter({ hasText: 'Hello banana' });
    await expect(ownerRow.getByRole('button', { name: 'Reaction 👍', exact: true })).toContainText('1');
    const ids: string[] = [];
    await member.route('**/reaction', async route => { ids.push((route.request().postDataJSON() as { clientRequestId: string }).clientRequestId); const response = await route.fetch(); if (ids.length === 1) await route.abort(); else await route.fulfill({ response }); });
    await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
    await row.getByRole('button', { name: 'Choose reaction 🎉', exact: true }).click(); await expect(row.getByRole('button', { name: 'Retry reaction', exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Retry reaction', exact: true }).click(); await expect(row.getByRole('button', { name: 'Retry reaction', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Reaction 🎉', exact: true })).toBeEnabled();
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]); await member.unroute('**/reaction');
    await expect(row.getByRole('button', { name: 'Reaction 🎉', exact: true })).toContainText('1');
    await member.reload(); await expect(row.getByRole('button', { name: 'Reaction 👍', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(member.getByText('Unread messages: 1', { exact: true })).toBeVisible();
    await member.getByRole('button', { name: 'Mark as read', exact: true }).click(); await expect(member.getByText('Unread messages: 0', { exact: true })).toBeVisible();
    await member.getByLabel('Search this channel', { exact: true }).fill('Привет'); await member.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(member.locator('.search-results')).toContainText('Hello banana');
    await member.getByRole('button', { name: 'Close search', exact: true }).click();
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await member.screenshot({ path: info.outputPath('m5-completeness.png'), fullPage: true });
    await member.getByRole('button', { name: 'Русский', exact: true }).click(); await expect(member.getByLabel('Поиск в этом канале', { exact: true })).toBeVisible();
    await member.getByLabel('Поиск в этом канале', { exact: true }).fill('banana'); await member.getByRole('button', { name: 'Найти', exact: true }).click();
    await expect(member.locator('.search-results')).toContainText('Hello banana');
    await page.getByRole('button', { name: 'Ban Complete member', exact: true }).click();
    await expect(member.locator('.search-results')).toHaveCount(0, { timeout: 20_000 });
    await expect(member.getByRole('list', { name: 'Сообщения', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
test('M5 custom emoji upload, insertion, reaction and removal use private images', async ({ page }, info) => {
  await register(page, 'Emoji owner'); await community(page);
  await page.locator('.emoji-management > summary').click();
  await page.getByLabel('Emoji name', { exact: true }).fill('tiny');
  await page.getByLabel('Emoji PNG', { exact: true }).setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: 'Upload emoji', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove emoji tiny', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insert emoji', exact: true }).click(); await expect(page.getByRole('button', { name: 'Insert emoji tiny', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insert emoji tiny', exact: true }).click(); await expect(page.getByLabel('Message', { exact: true })).toHaveValue(':tiny:');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const rows = page.getByRole('list', { name: 'Messages', exact: true });
  await expect(rows.getByRole('img', { name: ':tiny:', exact: true })).toBeVisible();
  await expect.poll(() => rows.getByRole('img', { name: ':tiny:', exact: true }).evaluate(e => (e as HTMLImageElement).naturalWidth)).toBe(1);
  await rows.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await rows.getByRole('button', { name: 'Choose reaction tiny', exact: true }).click(); await expect(rows.getByRole('button', { name: 'Reaction tiny', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('m5-emoji.png'), fullPage: true });
  await page.getByRole('button', { name: 'Remove emoji tiny', exact: true }).click();
  await expect(rows.getByRole('button', { name: 'Reaction Removed emoji', exact: true })).toBeVisible();
  await rows.getByRole('button', { name: 'Reaction Removed emoji', exact: true }).click(); await expect(rows.getByRole('button', { name: 'Reaction Removed emoji', exact: true })).toHaveCount(0);
});
test('M5 profiles are editable by owner and readable by another signed-in user without email', async ({ page, browser }, info) => {
  await register(page, 'Profile owner'); await page.getByRole('link', { name: 'Edit games, interests and profile details', exact: true }).click();
  await page.getByLabel('About me', { exact: true }).fill('<script>plain profile</script>'); await page.getByLabel('Games I play', { exact: true }).fill('Chess');
  await page.getByLabel('Interests', { exact: true }).fill('Music'); await page.getByLabel('Looking for teammates', { exact: true }).fill('Evening casual team');
  await page.getByRole('button', { name: 'Save profile details', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Profile saved.');
  const url = page.url(); await page.reload(); await expect(page.getByLabel('Games I play', { exact: true })).toHaveValue('Chess');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try { const visitor = await context.newPage(); await register(visitor, 'Profile visitor'); await visitor.goto(url);
    await expect(visitor.getByRole('heading', { name: 'Profile owner', exact: true })).toBeVisible(); await expect(visitor.locator('dl')).toContainText('Evening casual team');
    await expect(visitor.getByRole('button', { name: 'Save profile details', exact: true })).toHaveCount(0); await expect(visitor.locator('.public-profile')).not.toContainText('@example.test');
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await visitor.screenshot({ path: info.outputPath('m5-profile.png'), fullPage: true });
  } finally { await context.close(); }
});
