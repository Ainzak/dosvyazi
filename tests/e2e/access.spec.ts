import { test, expect } from '@playwright/test';
import type { Page, Browser } from '@playwright/test';

// Two browser contexts and several policy transitions, each with live reconciliation.
test.setTimeout(60000);

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`access-browser-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic access browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function create(page: Page) {
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Access crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access crew', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  await page.getByRole('link', { name: 'general', exact: true }).click();
  return { code, url: page.url() };
}
async function join(browser: Browser, owner: Page, code: string) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: owner.viewportSize()! });
  const page = await context.newPage(); await register(page, 'Access member'); await page.goto('/communities');
  await page.getByLabel('Invitation code', { exact: true }).fill(code); await page.getByRole('button', { name: 'Join community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access crew', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'general', exact: true }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  return { page, context };
}
async function save(page: Page) {
  const response = page.waitForResponse(r => r.url().endsWith('/access') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save access', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Save access', exact: true })).toBeEnabled();
}

test('category denial beats channel allow, removes cached history and preserves community navigation', async ({ page, browser }, info) => {
  await register(page, 'Access owner'); const room = await create(page); const member = await join(browser, page, room.code);
  try {
    await page.getByLabel('Message', { exact: true }).fill('Protected cached history'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(member.page.getByText('Protected cached history', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Manage access', exact: true }).click();
    await page.getByLabel('New category', { exact: true }).fill('Policies'); await page.getByRole('button', { name: 'Add category', exact: true }).click();
    await page.getByLabel('Category for general').selectOption({ label: 'Policies' });
    await page.getByLabel('SendMessage rule', { exact: true }).selectOption('Allow');
    await page.getByLabel('Resource type', { exact: true }).selectOption('categoryRules');
    await page.getByLabel('SendMessage rule', { exact: true }).selectOption('Deny'); await save(page);
    await expect(member.page.getByText('Read only: category rule for everyone', { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(member.page.getByLabel('Message', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('text-access-editor.png'), fullPage: true });
    // Save reloads the editor; select the category again.
    await page.getByLabel('Resource type', { exact: true }).selectOption('categoryRules');
    await page.getByLabel('ViewChannel rule', { exact: true }).selectOption('Deny'); await save(page);
    await expect(member.page.getByRole('heading', { name: 'Channel unavailable.', exact: true })).toBeVisible({ timeout: 12000 });
    await expect(member.page.getByText('Protected cached history', { exact: true })).toHaveCount(0);
    await expect(member.page.getByRole('heading', { name: 'Access crew', exact: true })).toBeVisible();
    await member.page.screenshot({ path: info.outputPath('channel-access-revoked.png'), fullPage: true });
    await page.getByLabel('Resource type', { exact: true }).selectOption('categoryRules');
    await page.getByLabel('ViewChannel rule', { exact: true }).selectOption('Inherit'); await save(page);
    await expect(member.page.getByText('Protected cached history', { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(member.page.getByText('Read only: category rule for everyone', { exact: true })).toBeVisible();
  } finally { await member.context.close(); }
});

test('assigned role grants a private channel and removal hides it without exposing management', async ({ page, browser }, info) => {
  await register(page, 'Private owner'); const room = await create(page); const member = await join(browser, page, room.code);
  try {
    await page.route('**/api/v1/communities/*/access', async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.abort('failed'); });
    await page.getByRole('button', { name: 'Manage access', exact: true }).click();
    await expect(page.getByText('Loading text access…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry access', exact: true })).toBeVisible({ timeout: 15000 });
    await page.unroute('**/api/v1/communities/*/access'); await page.getByRole('button', { name: 'Retry access', exact: true }).click();
    await page.getByLabel('Grant ViewChannel', { exact: true }).uncheck();
    await page.getByLabel('ViewChannel rule', { exact: true }).selectOption('Allow');
    await page.getByLabel('New role', { exact: true }).fill('Private'); await page.getByRole('button', { name: 'Add role', exact: true }).click();
    await page.getByLabel('New text channel', { exact: true }).fill('secret'); await page.getByRole('button', { name: 'Add channel', exact: true }).click();
    await page.getByLabel('Selected role', { exact: true }).selectOption({ label: 'Private' });
    await page.getByLabel('Resource', { exact: true }).selectOption({ label: 'secret' });
    await page.getByLabel('ViewChannel rule', { exact: true }).selectOption('Allow');
    await page.getByLabel('SendMessage rule', { exact: true }).selectOption('Allow'); await save(page);
    await expect(page.getByRole('link', { name: 'secret', exact: true })).toBeVisible();
    await expect(member.page.getByRole('link', { name: 'secret', exact: true })).toHaveCount(0);
    await expect(member.page.getByRole('button', { name: 'Manage access', exact: true })).toHaveCount(0);
    await page.getByLabel('Private for Access member', { exact: true }).check(); await save(page);
    await expect(member.page.getByRole('link', { name: 'secret', exact: true })).toBeVisible({ timeout: 12000 });
    await member.page.getByRole('link', { name: 'secret', exact: true }).click();
    await expect(member.page.getByRole('heading', { name: '#secret', exact: true })).toBeVisible();
    await member.page.getByLabel('Message', { exact: true }).fill('Private role message'); await member.page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(member.page.getByText('Private role message', { exact: true })).toBeVisible();
    await member.page.screenshot({ path: info.outputPath('private-role-channel.png'), fullPage: true });
    await page.getByLabel('Private for Access member', { exact: true }).uncheck(); await save(page);
    await expect(member.page.getByRole('heading', { name: 'Channel unavailable.', exact: true })).toBeVisible({ timeout: 12000 });
    await expect(member.page.getByText('Private role message', { exact: true })).toHaveCount(0);
    await member.page.getByRole('link', { name: 'general', exact: true }).click();
    await expect(member.page.getByRole('heading', { name: '#general', exact: true })).toBeVisible();
  } finally { await member.context.close(); }
});
