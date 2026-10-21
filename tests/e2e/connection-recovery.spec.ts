import { expect, test } from '@playwright/test';
import { changeLanguage } from './workspace-navigation';

test('one shared recovery action restores session and communities without clearing a draft', async ({ page }, info) => {
  test.setTimeout(60000);
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill('Recovery tester');
  await page.getByLabel('Email address', { exact: true }).fill(`recovery-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic recovery passphrase 42'); await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Recovery tester.', exact: true })).toBeVisible();
  await page.goto('/communities'); await changeLanguage(page, 'ru');
  await page.getByLabel('Название сообщества', { exact: true }).fill('Draft survives outage');
  let failed = true;
  await page.route('**/api/v1/account/me', route => failed ? route.fulfill({ status: 503, json: { title: 'Unavailable' } }) : route.continue());
  await page.route('**/api/v1/communities', route => route.request().method() === 'GET' && failed ? route.fulfill({ status: 503, json: { title: 'Unavailable' } }) : route.continue());
  const recovery = page.getByRole('region', { name: 'Восстановление соединения', exact: true });
  await expect(recovery).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Восстановить соединение', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Попробовать снова', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Повторить проверку сессии', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('shared-recovery-ru.png'), fullPage: true });
  failed = false; await recovery.getByRole('button', { name: 'Восстановить соединение', exact: true }).click();
  await expect(recovery).toHaveCount(0); await expect(page.getByLabel('Название сообщества', { exact: true })).toHaveValue('Draft survives outage');
  await expect(page.getByRole('heading', { name: 'Сообществ пока нет.', exact: true })).toBeVisible();
});
