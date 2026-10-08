import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`community-browser-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic community browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function create(page: Page, name = 'Weekend crew') {
  await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return page.url();
}
async function invite(page: Page) {
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(page.getByLabel('Share this invitation code')).toBeVisible();
  return page.getByLabel('Share this invitation code').inputValue();
}
async function join(page: Page, code: string, name = 'Weekend crew') {
  await page.goto('/communities');
  await page.getByLabel('Invitation code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Join community', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function otherContext(browser: Browser, page: Page) {
  return browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize() ?? { width: 1280, height: 900 } });
}

test('two members share a community and outsiders cannot open its channel', async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await register(page, 'Community owner');
  const name = 'A'.repeat(80);
  await create(page, name);
  const code = await invite(page);
  await page.getByRole('link', { name: 'general', exact: true }).click();
  await expect(page.getByRole('heading', { name: '#general' })).toBeVisible();
  const channelUrl = page.url();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('community-owner.png'), fullPage: true });
  const memberContext = await otherContext(browser, page);
  const outsiderContext = await otherContext(browser, page);
  try {
    const member = await memberContext.newPage();
    member.on('pageerror', error => errors.push(error.message));
    await register(member, 'Invited member');
    await join(member, code, name);
    await expect(member.getByRole('heading', { name: 'Invite people' })).toHaveCount(0);
    await member.getByRole('link', { name: 'general', exact: true }).click();
    await expect(member.getByRole('heading', { name: '#general' })).toBeVisible();
    await member.reload();
    await expect(member.getByRole('heading', { name: '#general' })).toBeVisible();
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await member.screenshot({ path: info.outputPath('community-member.png'), fullPage: true });
    const outsider = await outsiderContext.newPage();
    await register(outsider, 'Outside member');
    await outsider.goto(channelUrl);
    await expect(outsider.getByRole('heading', { name: 'Community unavailable.' })).toBeVisible();
    await expect(outsider.getByRole('heading', { name, exact: true })).toHaveCount(0);
    await expect(outsider.getByRole('heading', { name: '#general' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await memberContext.close(); await outsiderContext.close(); }
});

test('ban clears a cached channel, lifting requires rejoin, leave and revocation deny access', async ({ page, browser }) => {
  test.setTimeout(45_000);
  await register(page, 'Community owner');
  await create(page);
  const code = await invite(page);
  const memberContext = await otherContext(browser, page);
  try {
    const member = await memberContext.newPage();
    await register(member, 'Invited member');
    await join(member, code);
    await member.getByRole('link', { name: 'general', exact: true }).click();
    await expect(member.getByRole('heading', { name: '#general' })).toBeVisible();
    const channelUrl = member.url();
    await page.reload();
    await page.getByRole('button', { name: 'Ban Invited member', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Lift ban for Invited member' })).toBeVisible();
    // No reload: the periodic query must revoke the rendered/cached private workspace.
    await expect(member.getByRole('heading', { name: 'Community unavailable.' })).toBeVisible({ timeout: 20_000 });
    await expect(member.getByRole('heading', { name: '#general' })).toHaveCount(0);
    await expect(member.getByRole('heading', { name: 'Weekend crew', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Lift ban for Invited member' }).click();
    await expect(page.getByRole('button', { name: 'Ban Invited member', exact: true })).toBeVisible();
    await member.goto(channelUrl);
    await expect(member.getByRole('heading', { name: 'Community unavailable.' })).toBeVisible();
    await join(member, code);
    await member.getByRole('button', { name: 'Leave community' }).click();
    await expect(member.getByRole('heading', { name: 'No communities yet.' })).toBeVisible();
    await member.goto(channelUrl);
    await expect(member.getByRole('heading', { name: 'Community unavailable.' })).toBeVisible();
    await page.getByRole('button', { name: /^Revoke invitation/ }).click();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(code);
    await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await expect(member.getByRole('alert')).toContainText('Invitation is unavailable.');
  } finally { await memberContext.close(); }
});

test('a different account cannot reuse the previous account community cache', async ({ page }) => {
  await register(page, 'First account');
  const previous = await create(page, 'First account private space');
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await register(page, 'Second account');
  await page.goto('/communities');
  await expect(page.getByRole('heading', { name: 'No communities yet.' })).toBeVisible();
  await expect(page.getByText('First account private space', { exact: true })).toHaveCount(0);
  await page.goto(previous);
  await expect(page.getByRole('heading', { name: 'Community unavailable.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'First account private space', exact: true })).toHaveCount(0);
});

test('loading, offline recovery and a lost creation response keep retries safe', async ({ page }, info) => {
  await register(page, 'Retry account');
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/communities', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/communities');
    await expect(page.getByRole('status')).toHaveText('Loading communities…');
    await page.screenshot({ path: info.outputPath('community-loading.png'), fullPage: true });
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'No communities yet.' })).toBeVisible();
  await page.unroute('**/api/v1/communities');
  await page.route('**/api/v1/communities', route => route.abort('connectionfailed'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connection interrupted.' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('community-error.png'), fullPage: true });
  await page.unroute('**/api/v1/communities');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No communities yet.' })).toBeVisible();
  await page.route('**/api/v1/communities', async route => {
    if (route.request().method() === 'POST') { await route.fetch(); await route.abort('connectionfailed'); }
    else await route.continue();
  });
  await page.getByLabel('Community name', { exact: true }).fill('Retry-safe space');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach Dosvyazi');
  await expect(page.getByLabel('Community name', { exact: true })).toHaveValue('Retry-safe space');
  await page.unroute('**/api/v1/communities');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Retry-safe space', exact: true })).toBeVisible();
  await page.goto('/communities');
  await expect(page.getByRole('link', { name: 'Retry-safe space Owner', exact: true })).toHaveCount(1);
});

test('anonymous visitors see an account entry point', async ({ page }) => {
  await page.goto('/communities');
  await expect(page.getByRole('heading', { name: 'A place for your people.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create community' })).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});
