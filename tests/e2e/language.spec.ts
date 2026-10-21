import { changeLanguage, communityOverview, workspaceLink } from './workspace-navigation';
import { expect, test } from '@playwright/test';

test('language is visible, saved and preserves user input and permission option values', async ({ page }, info) => {
  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Русский', exact: true })).toBeVisible();
  await page.getByLabel('Display name', { exact: true }).fill('Owner');
  await page.getByLabel('Email address', { exact: true }).fill(`language-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic language passphrase 42');
  await changeLanguage(page, 'ru');
  await expect(page.getByLabel('Отображаемое имя', { exact: true })).toHaveValue('Owner');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Добро пожаловать, Owner.' })).toBeVisible();
  await workspaceLink(page, 'Сообщества');
  await page.getByLabel('Название сообщества', { exact: true }).fill('Community name stays unchanged');
  await page.getByRole('button', { name: 'Создать сообщество', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Community name stays unchanged', exact: true })).toBeVisible();
  await communityOverview(page); await page.getByRole('button', { name: 'Управлять доступом', exact: true }).click();
  const rule = page.getByLabel('Правило Отправлять сообщения', { exact: true });
  await rule.selectOption('Deny');
  await expect(rule).toHaveValue('Deny');
  const saved = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/access'));
  await page.getByRole('button', { name: 'Сохранить доступ', exact: true }).click();
  const payload: { policy: { channelRules: { deny: number }[] } } = (await saved).postDataJSON();
  expect(payload.policy.channelRules.some(value => (value.deny & 2) !== 0)).toBe(true);
  await expect(page.getByRole('button', { name: 'Сохранить доступ', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Закрыть настройки доступа', exact: true }).click();
  await workspaceLink(page, 'general');
  await page.getByLabel('Сообщение', { exact: true }).fill('Owner and Community content stays English');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText('Owner and Community content stays English');
  // A pending row is visible before persistence; reload only after acknowledgement.
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.message-list')).toContainText('Owner and Community content stays English');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('russian-text.png'), fullPage: true });
  await changeLanguage(page, 'en');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
});

test('brief session/community failures recover before showing connection alerts', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Recovery account');
  await page.getByLabel('Email address', { exact: true }).fill(`retry-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic retry passphrase 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Recovery account.', exact: true })).toBeVisible();
  await workspaceLink(page, 'Communities');
  await page.getByLabel('Community name', { exact: true }).fill('Transient errors');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transient errors', exact: true })).toBeVisible();
  const community = new URL(page.url()).pathname.split('/')[2]!;
  let profileAttempts = 0; let communityAttempts = 0;
  await page.route('**/account/me', async route => { profileAttempts++; if (profileAttempts === 1) await route.abort('connectionfailed'); else await route.continue(); });
  await page.route(`**/api/v1/communities/${community}`, async route => { communityAttempts++; if (communityAttempts === 1) await route.fulfill({ status: 503, json: { title: 'Temporarily unavailable' } }); else await route.continue(); });
  const alerts: string[] = [];
  await page.exposeFunction('recordConnectionAlert', (text: string) => alerts.push(text));
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      for (const alert of document.querySelectorAll('[role="alert"]')) if (/Session check interrupted|Community check interrupted/.test(alert.textContent ?? '')) {
        void (window as unknown as { recordConnectionAlert: (text: string) => Promise<void> }).recordConnectionAlert(alert.textContent ?? '');
      }
    }); observer.observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Transient errors', exact: true })).toBeVisible();
  expect(profileAttempts).toBeGreaterThanOrEqual(2); expect(communityAttempts).toBeGreaterThanOrEqual(2);
  expect(alerts).toEqual([]);
  await page.route('**/account/me', route => route.abort('connectionfailed'));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Cannot reach Dosvyazi', { timeout: 15_000 });
  await page.unroute('**/account/me');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transient errors', exact: true })).toBeVisible();
});
