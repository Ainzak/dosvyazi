import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const password = 'Synthetic browser passphrase 42';
const email = () => `browser-${crypto.randomUUID()}@example.test`;

async function createAccount(page: Page, address = email()) {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Browser member');
  await page.getByLabel('Email address', { exact: true }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Browser member.' })).toBeVisible();
  return address;
}

test('register, edit, reload, logout and login against the actual API', async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create your account.' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('register.png'), fullPage: true });
  const address = await createAccount(page);
  await page.getByLabel('Display name', { exact: true }).fill('Updated member');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Profile saved.');
  await expect(page.getByRole('heading', { name: 'Welcome, Updated member.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome, Updated member.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true });
  const sessionCookie = (await context.cookies()).find(cookie => cookie.name === 'dosvyazi.session');
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill('incorrect password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to sign in.');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Updated member.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('duplicates show an error and another tab observes logout', async ({ page, context }) => {
  const address = await createAccount(page);
  const second = await context.newPage();
  await second.goto('/account');
  await expect(second.getByRole('heading', { name: 'Welcome, Browser member.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await second.reload();
  await expect(second.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Another name');
  await page.getByLabel('Email address', { exact: true }).fill(address.toUpperCase());
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to create an account');
  await expect(page.getByRole('heading', { name: 'Create your account.' })).toBeVisible();
});

test('session loading, interrupted connection and recovery preserve the account', async ({ page }) => {
  await createAccount(page);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/account/me', async route => { await gate; await route.continue(); });
  try {
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Checking your session…');
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Welcome, Browser member.' })).toBeVisible();
  await page.unroute('**/api/v1/account/me');
  await page.route('**/api/v1/account/me', route => route.abort('connectionfailed'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connection interrupted.' })).toBeVisible();
  await page.unroute('**/api/v1/account/me');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Browser member.' })).toBeVisible();
});

test('failed profile update keeps the entered value and can be retried', async ({ page }) => {
  await createAccount(page);
  await page.route('**/api/v1/account/me', route => route.request().method() === 'PUT' ? route.abort('connectionfailed') : route.continue());
  await page.getByLabel('Display name', { exact: true }).fill('Retry member');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach Dosvyazi');
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Retry member');
  await page.unroute('**/api/v1/account/me');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Retry member.' })).toBeVisible();
});
