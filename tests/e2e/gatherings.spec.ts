import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`gathering-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic gathering browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function createCommunity(page: Page) {
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Gathering crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gathering crew', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  return { code, url: page.url() };
}
test('M6 gathering decisions, discussion, revisions, covers and cancellation', async ({ page, browser }, info) => {
  test.setTimeout(100_000);
  await register(page, 'Gathering owner'); const c = await createCommunity(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const member = await context.newPage(); await register(member, 'Gathering guest'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(c.code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await expect(member.getByRole('heading', { name: 'Gathering crew', exact: true })).toBeVisible();
    await member.getByRole('link', { name: 'Gatherings', exact: true }).click();
    await expect(member.getByText('No gatherings yet. Create one or wait for an invitation.', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Gatherings', exact: true }).click();
    await page.getByRole('button', { name: 'New gathering', exact: true }).click();
    await page.getByLabel('Gathering title (optional)', { exact: true }).fill('Friday game');
    await page.getByLabel('Game (optional)', { exact: true }).fill('Chess'); await page.getByLabel('Time zone', { exact: true }).fill('UTC');
    await page.getByLabel('Invite Gathering guest', { exact: true }).check();
    await page.getByRole('button', { name: 'Create gathering', exact: true }).click();
    const detail = page.locator('.gathering-detail'); await expect(detail.getByRole('heading', { name: 'Friday game', exact: true })).toBeVisible();
    await expect(member.getByRole('link', { name: 'Friday game', exact: true })).toBeVisible();
    await member.getByRole('link', { name: 'Friday game', exact: true }).click(); const guest = member.locator('.gathering-detail');
    await guest.getByRole('button', { name: 'Accept gathering', exact: true }).click(); await expect(detail.locator('.gathering-counts')).toContainText('Accepted: 1');
    await guest.getByLabel('Discussion comment', { exact: true }).fill('I am ready'); await guest.getByRole('button', { name: 'Add discussion comment', exact: true }).click();
    await expect(detail.locator('.gathering-discussion')).toContainText('I am ready'); await expect(detail.locator('.gathering-counts')).toContainText('Accepted: 1');
    await guest.getByLabel('Clarification request', { exact: true }).fill('Which rules?'); await guest.getByRole('button', { name: 'Request clarification', exact: true }).click();
    await expect(detail.locator('.gathering-counts')).toContainText('Needs clarification: 1');
    await detail.getByLabel('Discussion comment', { exact: true }).fill('Standard rules'); await detail.getByRole('button', { name: 'Add discussion comment', exact: true }).click();
    await expect(guest.locator('.gathering-discussion')).toContainText('Standard rules'); await expect(guest.locator('.gathering-counts')).toContainText('Needs clarification: 1');
    await guest.getByRole('button', { name: 'Accept gathering', exact: true }).click(); await expect(detail.locator('.gathering-counts')).toContainText('Accepted: 1');
    await detail.getByLabel('PNG or JPEG cover', { exact: true }).setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=', 'base64') });
    await detail.getByRole('button', { name: 'Upload cover', exact: true }).click(); await expect(guest.getByRole('img', { name: 'Gathering cover', exact: true })).toBeVisible();
    await expect.poll(() => guest.getByRole('img', { name: 'Gathering cover', exact: true }).evaluate(e => (e as HTMLImageElement).naturalWidth)).toBe(1);
    await expect(guest.locator('.gathering-counts')).toContainText('Accepted: 1');
    const jpeg = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; const drawing = canvas.getContext('2d')!; drawing.fillStyle = '#2d6150'; drawing.fillRect(0, 0, 2, 2); return canvas.toDataURL('image/jpeg').split(',')[1]!; });
    await detail.getByLabel('PNG or JPEG cover', { exact: true }).setInputFiles({ name: 'small.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
    await detail.getByRole('button', { name: 'Upload cover', exact: true }).click();
    await expect.poll(() => guest.getByRole('img', { name: 'Gathering cover', exact: true }).evaluate(e => (e as HTMLImageElement).naturalWidth)).toBe(2);
    await detail.getByRole('button', { name: 'Remove cover', exact: true }).click(); await expect(guest.getByRole('img', { name: 'Gathering cover', exact: true })).toHaveCount(0);
    await detail.getByRole('button', { name: 'Edit gathering', exact: true }).click(); await detail.getByLabel('Game (optional)', { exact: true }).fill('Checkers');
    await detail.getByRole('button', { name: 'Save gathering', exact: true }).click(); await expect(guest.getByText('The schedule or game changed. Review this plan before responding again.', { exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Accept gathering', exact: true })).toBeDisabled(); await expect(guest.locator('.gathering-counts')).toContainText('Pending: 1');
    await guest.getByRole('button', { name: 'Review updated plan', exact: true }).click(); await guest.getByRole('button', { name: 'Accept gathering', exact: true }).click();
    await expect(detail.locator('.gathering-counts')).toContainText('Accepted: 1'); await detail.getByRole('button', { name: 'Previous plans', exact: true }).click();
    await expect(detail.locator('.gathering-previous')).toContainText('Chess'); await expect(detail.locator('.gathering-previous')).toContainText('Accepted: 1');
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await member.screenshot({ path: info.outputPath('m6-gathering.png'), fullPage: true });
    await member.getByRole('button', { name: 'Русский', exact: true }).click(); await expect(guest.getByRole('button', { name: 'Принять приглашение', exact: true })).toBeVisible();
    await member.reload(); await expect(guest.locator('.gathering-counts')).toContainText('Принято: 1');
    await detail.getByRole('button', { name: 'Cancel gathering', exact: true }).click(); await expect(guest.getByText('Этот сбор закрыт. Ответы и изменения недоступны.', { exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Принять приглашение', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('M6 lost creation acknowledgement, stale editor, offline recovery and ban clear private data', async ({ page, browser }, info) => {
  test.setTimeout(100_000);
  await register(page, 'Retry owner'); const c = await createCommunity(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const member = await context.newPage(); await register(member, 'Retry guest'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(c.code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await expect(member.getByRole('heading', { name: 'Gathering crew', exact: true })).toBeVisible();
    await member.getByRole('link', { name: 'Gatherings', exact: true }).click();
    await page.getByRole('link', { name: 'Gatherings', exact: true }).click(); await page.getByRole('button', { name: 'New gathering', exact: true }).click();
    await page.getByLabel('Gathering title (optional)', { exact: true }).fill('Retried plan'); await page.getByLabel('Invite Retry guest', { exact: true }).check();
    const ids: string[] = [];
    await page.route('**/gatherings', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      ids.push((route.request().postDataJSON() as { clientRequestId: string }).clientRequestId);
      const response = await route.fetch(); if (ids.length === 1) await route.abort(); else await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Create gathering', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Your draft is retained.');
    await page.getByRole('button', { name: 'Create gathering', exact: true }).click(); const detail = page.locator('.gathering-detail');
    await expect(detail.getByRole('heading', { name: 'Retried plan', exact: true })).toBeVisible(); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]); await page.unroute('**/gatherings');
    await expect(page.locator('.gathering-list').getByRole('link', { name: 'Retried plan', exact: true })).toHaveCount(1);
    await member.getByRole('link', { name: 'Retried plan', exact: true }).click(); const guest = member.locator('.gathering-detail');
    await detail.getByRole('button', { name: 'Edit gathering', exact: true }).click(); await detail.getByLabel('Description (optional)', { exact: true }).fill('Retained draft');
    await guest.getByRole('button', { name: 'Decline gathering', exact: true }).click(); await expect(detail.locator('.gathering-counts')).toContainText('Declined: 1');
    await detail.getByRole('button', { name: 'Save gathering', exact: true }).click(); await expect(detail.getByRole('alert')).toContainText('Gathering changed.');
    await expect(detail.getByLabel('Description (optional)', { exact: true })).toHaveValue('Retained draft');
    await detail.getByRole('button', { name: 'Close editor', exact: true }).first().click();
    await context.setOffline(true); await expect(member.getByText('Offline.', { exact: true })).toBeVisible();
    await detail.getByRole('button', { name: 'Edit gathering', exact: true }).click(); await detail.getByLabel('Game (optional)', { exact: true }).fill('New offline game');
    await detail.getByRole('button', { name: 'Save gathering', exact: true }).click(); await expect(detail.getByText('Game: New offline game', { exact: true })).toBeVisible();
    await context.setOffline(false); await expect(guest.getByText('Game: New offline game', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator('.gathering-counts')).toContainText('Pending: 1');
    await member.screenshot({ path: info.outputPath('m6-recovery.png'), fullPage: true });
    await page.goto(c.url); await page.getByRole('button', { name: 'Ban Retry guest', exact: true }).click();
    await expect(member.getByRole('heading', { name: 'Community unavailable.', exact: true })).toBeVisible({ timeout: 20_000 }); await expect(guest).toHaveCount(0);
  } finally { await context.close(); }
});

test('M6 gathering loading, unavailable list retry and long text fit the viewport', async ({ page, browser }, info) => {
  await register(page, 'Long owner'); const c = await createCommunity(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const member = await context.newPage(); await register(member, 'Long guest'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(c.code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await expect(member.getByRole('heading', { name: 'Gathering crew', exact: true })).toBeVisible();
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/gatherings?offset=0', async route => { await held; await route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Synthetic list interruption', status: 503 }) }); });
    await page.getByRole('link', { name: 'Gatherings', exact: true }).click(); await expect(page.getByText('Loading gatherings…', { exact: true })).toBeVisible(); release();
    await expect(page.getByRole('alert')).toContainText('Synthetic list interruption'); await page.unroute('**/gatherings?offset=0');
    await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.getByText('No gatherings yet. Create one or wait for an invitation.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New gathering', exact: true }).click(); const title = 'T'.repeat(80);
    await page.getByLabel('Gathering title (optional)', { exact: true }).fill(title); await page.getByLabel('Game (optional)', { exact: true }).fill('G'.repeat(80));
    await page.getByLabel('Description (optional)', { exact: true }).fill('D'.repeat(2000)); await page.getByLabel('Invite Long guest', { exact: true }).check();
    await page.getByRole('button', { name: 'Create gathering', exact: true }).click(); await expect(page.locator('.gathering-detail').getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('m6-long-text.png'), fullPage: true });
  } finally { await context.close(); }
});
