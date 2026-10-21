import { changeLanguage, communityOverview, workspaceLink } from './workspace-navigation';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectReadableText } from './readability';
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
  await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  return { code, url: page.url() };
}

test('Gatherings list and detail separate tasks, retain keyboard focus, explain responses and confirm cancellation', async ({ page, browser }, info) => {
  await register(page, 'Design owner'); const c = await createCommunity(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const member = await context.newPage(); await register(member, 'Design guest'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(c.code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await workspaceLink(page, 'Gatherings');
    const create = page.getByRole('button', { name: 'New gathering', exact: true }); await create.click();
    await expect(page.getByLabel('Gathering title (optional)', { exact: true })).toBeFocused();
    await page.locator('.gathering-create').getByRole('button', { name: 'Close editor', exact: true }).click();
    await expect(create).toBeFocused(); await create.click();
    await page.getByLabel('Gathering title (optional)', { exact: true }).fill('Co-op Sunday');
    await page.getByLabel('Game (optional)', { exact: true }).fill('Chess');
    await page.getByLabel('Time zone', { exact: true }).fill('UTC');
    await page.getByLabel('Invite Design guest', { exact: true }).check();
    await expect(page.getByText('1 of 50 participants selected', { exact: true })).toBeVisible();
    await expectReadableText(page.locator('.gathering-create'));
    await page.screenshot({ path: info.outputPath('gathering-create.png'), fullPage: true });
    await page.getByRole('button', { name: 'Create gathering', exact: true }).click();
    const detail = page.locator('.gathering-detail'); await expect(detail.getByRole('heading', { name: 'Co-op Sunday', level: 1 })).toBeVisible();
    await expect(page.locator('.gathering-list')).toHaveCount(0); await expect(page.locator('.gathering-notices')).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Accept gathering', exact: true })).toHaveCount(0);
    await expect(detail.locator('.gathering-participant-list')).toContainText('Design owner');
    await workspaceLink(member, 'Gatherings');
    const notices = member.locator('.gathering-notices');
    const invitation = notices.locator('li').filter({ hasText: 'New gathering invitation' });
    await expect(invitation).toHaveCount(1);
    await invitation.getByRole('button', { name: 'Mark notification read', exact: true }).click();
    await expect(invitation.getByRole('button')).toHaveCount(0);
    await expectReadableText(member.locator('.gatherings-page'));
    await member.screenshot({ path: info.outputPath('gathering-list.png'), fullPage: true });
    await invitation.getByRole('link', { name: 'New gathering invitation', exact: true }).click();
    const guest = member.locator('.gathering-detail');
    await expect(guest.getByRole('button', { name: 'Edit gathering', exact: true })).toHaveCount(0);
    await guest.getByRole('button', { name: 'Accept gathering', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Accept gathering', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(detail.locator('.gathering-counts')).toContainText('Accepted: 1');
    await guest.getByRole('button', { name: 'Ask for clarification', exact: true }).click();
    const clarification = guest.getByLabel('Clarification request', { exact: true }); await expect(clarification).toBeFocused();
    await clarification.fill('A retained question');
    await guest.getByRole('button', { name: 'Close clarification', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Ask for clarification', exact: true })).toBeFocused();
    await guest.getByRole('button', { name: 'Ask for clarification', exact: true }).click();
    await expect(clarification).toHaveValue('A retained question');
    await guest.getByRole('button', { name: 'Close clarification', exact: true }).click();
    await expectReadableText(guest);
    await member.locator('main').evaluate(element => { element.scrollTop = 0; });
    await member.screenshot({ path: info.outputPath('gathering-detail.png'), fullPage: true });
    await changeLanguage(member, 'ru');
    await expect(guest.getByRole('button', { name: 'Принять приглашение', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectReadableText(guest);
    await member.locator('main').evaluate(element => { element.scrollTop = 0; });
    await member.screenshot({ path: info.outputPath('gathering-detail-ru.png'), fullPage: true });
    const cancel = detail.getByRole('button', { name: 'Cancel gathering', exact: true }); await cancel.click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this gathering?', exact: true });
    await expect(dialog.getByRole('button', { name: 'Keep gathering', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(cancel).toBeFocused(); await expect(detail.locator('.gathering-meta')).toContainText('Scheduled');
    await cancel.click(); await dialog.getByRole('button', { name: 'Keep gathering', exact: true }).click(); await expect(cancel).toBeFocused();
    await cancel.click(); await page.screenshot({ path: info.outputPath('gathering-cancel.png'), fullPage: true });
    // A background update must not silently replace the version being confirmed.
    await guest.getByLabel('Комментарий к обсуждению', { exact: true }).fill('Changed while cancellation was open');
    await guest.getByRole('button', { name: 'Добавить комментарий', exact: true }).click();
    await expect(detail.locator('.gathering-discussion')).toContainText('Changed while cancellation was open');
    await dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(detail.getByRole('alert')).toContainText('Gathering changed.');
    await expect(detail.getByRole('button', { name: 'Retry gathering action', exact: true })).toHaveCount(0);
    await detail.getByRole('button', { name: 'Review latest gathering', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Co-op Sunday', level: 1 })).toBeFocused();
    await cancel.click(); await dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(detail.getByText('This gathering is closed. Responses and changes are disabled.', { exact: true })).toBeVisible();
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('Gatherings hides transport jargon and explains cover review separately from schedule history', async ({ page, browser }, info) => {
  await register(page, 'Clarity owner'); const c = await createCommunity(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const peer = await context.newPage(); await register(peer, 'Clarity guest'); await peer.goto('/communities');
    await peer.getByLabel('Invitation code', { exact: true }).fill(c.code); await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await workspaceLink(page, 'Gatherings');
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
    await expect(page.getByText('Connecting…', { exact: true })).toHaveCount(0); await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'New gathering', exact: true }).click();
    await page.getByLabel('Gathering title (optional)', { exact: true }).fill('Clear plan controls');
    await page.getByLabel('Invite Clarity guest', { exact: true }).check(); await page.getByRole('button', { name: 'Create gathering', exact: true }).click();
    const detail = page.locator('.gathering-detail'); await expect(detail.getByRole('heading', { name: 'Clear plan controls', exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Use current plan version', exact: true })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'I reviewed the latest cover', exact: true })).toHaveCount(0);
    const history = detail.locator('.gathering-history'); await expect(history.getByRole('heading', { name: 'Schedule change history', exact: true })).toBeVisible();
    await history.getByRole('button', { name: 'View schedule changes', exact: true }).click();
    await expect(history.getByText('No previous schedule revisions.', { exact: true })).toBeVisible();
    await history.getByRole('button', { name: 'Hide schedule changes', exact: true }).click();
    await detail.getByLabel('PNG or JPEG cover', { exact: true }).setInputFiles({ name: 'retained.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=', 'base64') });
    await peer.goto(page.url()); await peer.getByRole('button', { name: 'Accept gathering', exact: true }).click();
    await expect(detail.locator('.gathering-counts')).toContainText('Accepted: 1');
    await detail.getByRole('button', { name: 'Upload cover', exact: true }).click();
    await expect(detail.getByRole('alert')).toContainText('The gathering changed while you were editing its cover.');
    await expect(detail.getByRole('button', { name: 'Upload cover', exact: true })).toBeDisabled();
    await expect(detail.getByRole('button', { name: 'I reviewed the latest cover', exact: true })).toBeEnabled();
    expect(await detail.getByLabel('PNG or JPEG cover', { exact: true }).evaluate(e => (e as HTMLInputElement).files?.[0]?.name)).toBe('retained.png');
    await page.screenshot({ path: info.outputPath('cover-conflict-guidance.png'), fullPage: true });
    await detail.getByRole('button', { name: 'I reviewed the latest cover', exact: true }).click();
    await expect(detail.getByRole('alert')).toHaveCount(0); await detail.getByRole('button', { name: 'Upload cover', exact: true }).click();
    await expect(detail.getByRole('img', { name: 'Gathering cover', exact: true })).toBeVisible();
    await page.route('**/gatherings/*/cover', route => route.fulfill({ status: 409, json: { title: 'Attachment storage is full. Ask the operator to free space.' } }));
    await detail.getByLabel('PNG or JPEG cover', { exact: true }).setInputFiles({ name: 'quota.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=', 'base64') });
    await detail.getByRole('button', { name: 'Upload cover', exact: true }).click(); await expect(detail.getByRole('alert')).toContainText('Attachment storage is full.');
    await expect(detail.getByRole('button', { name: 'I reviewed the latest cover', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
test('M6 gathering decisions, discussion, revisions, covers and cancellation', async ({ page, browser }, info) => {
  test.setTimeout(100_000);
  await register(page, 'Gathering owner'); const c = await createCommunity(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const member = await context.newPage(); await register(member, 'Gathering guest'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(c.code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await expect(member.getByRole('heading', { name: 'Gathering crew', exact: true })).toBeVisible();
    await workspaceLink(member, 'Gatherings');
    await expect(member.getByText('No gatherings yet. Create one or wait for an invitation.', { exact: true })).toBeVisible();
    await workspaceLink(page, 'Gatherings');
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
    await guest.getByRole('button', { name: 'Ask for clarification', exact: true }).click();
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
    await expect(detail.locator('.gathering-counts')).toContainText('Accepted: 1'); await detail.getByRole('button', { name: 'View schedule changes', exact: true }).click();
    await expect(detail.locator('.gathering-previous')).toContainText('Chess'); await expect(detail.locator('.gathering-previous')).toContainText('Accepted: 1');
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await member.screenshot({ path: info.outputPath('m6-gathering.png'), fullPage: true });
    await changeLanguage(member, 'ru'); await expect(guest.getByRole('button', { name: 'Принять приглашение', exact: true })).toBeVisible();
    await member.reload(); await expect(guest.locator('.gathering-counts')).toContainText('Принято: 1');
    await detail.getByRole('button', { name: 'Cancel gathering', exact: true }).click();
    await page.getByRole('dialog', { name: 'Cancel this gathering?', exact: true }).getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(guest.getByText('Этот сбор закрыт. Ответы и изменения недоступны.', { exact: true })).toBeVisible();
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
    await workspaceLink(member, 'Gatherings');
    await workspaceLink(page, 'Gatherings'); await page.getByRole('button', { name: 'New gathering', exact: true }).click();
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
    await page.getByRole('link', { name: 'All gatherings', exact: true }).click();
    await expect(page.locator('.gathering-list').getByRole('link', { name: 'Retried plan', exact: true })).toHaveCount(1);
    await page.locator('.gathering-list').getByRole('link', { name: 'Retried plan', exact: true }).click();
    await member.getByRole('link', { name: 'Retried plan', exact: true }).click(); const guest = member.locator('.gathering-detail');
    await detail.getByRole('button', { name: 'Edit gathering', exact: true }).click(); await detail.getByLabel('Description (optional)', { exact: true }).fill('Retained draft');
    await guest.getByRole('button', { name: 'Decline gathering', exact: true }).click(); await expect(detail.locator('.gathering-counts')).toContainText('Declined: 1');
    await detail.getByRole('button', { name: 'Save gathering', exact: true }).click(); await expect(detail.getByRole('alert')).toContainText('Gathering changed.');
    await expect(detail.getByLabel('Description (optional)', { exact: true })).toHaveValue('Retained draft');
    await detail.getByRole('button', { name: 'Close editor', exact: true }).first().click();
    await context.setOffline(true); await expect(member.getByText('You are offline. Gathering changes will appear when your connection returns.', { exact: true })).toBeVisible();
    await detail.getByRole('button', { name: 'Edit gathering', exact: true }).click(); await detail.getByLabel('Game (optional)', { exact: true }).fill('New offline game');
    await detail.getByRole('button', { name: 'Save gathering', exact: true }).click(); await expect(detail.getByText('Game: New offline game', { exact: true })).toBeVisible();
    await context.setOffline(false); await expect(guest.getByText('Game: New offline game', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator('.gathering-counts')).toContainText('Pending: 1');
    await member.screenshot({ path: info.outputPath('m6-recovery.png'), fullPage: true });
    await page.goto(c.url); await communityOverview(page); await page.getByRole('button', { name: 'Ban Retry guest', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
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
    await workspaceLink(page, 'Gatherings'); await expect(page.getByText('Loading gatherings…', { exact: true })).toBeVisible(); release();
    await expect(page.getByRole('alert')).toContainText('Synthetic list interruption'); await page.unroute('**/gatherings?offset=0');
    await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.getByText('No gatherings yet. Create one or wait for an invitation.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New gathering', exact: true }).click(); const title = 'T'.repeat(80);
    await page.getByLabel('Gathering title (optional)', { exact: true }).fill(title); await page.getByLabel('Game (optional)', { exact: true }).fill('G'.repeat(80));
    await page.getByLabel('Description (optional)', { exact: true }).fill('D'.repeat(2000)); await page.getByLabel('Invite Long guest', { exact: true }).check();
    await page.getByRole('button', { name: 'Create gathering', exact: true }).click(); await expect(page.locator('.gathering-detail').getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('m6-long-text.png'), fullPage: true });
  } finally { await context.close(); }
});
