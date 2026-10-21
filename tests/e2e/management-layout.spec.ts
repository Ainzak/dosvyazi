import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectReadableText } from './readability';
import { changeLanguage, workspaceLink } from './workspace-navigation';

async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`layout-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic management layout 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}

test('account and profile sections preserve a failed draft and remain readable in both languages', async ({ page }, info) => {
  await register(page, 'Layout member');
  await expect(page.getByRole('heading', { name: 'Account details', exact: true })).toBeVisible();
  await expectReadableText(page.locator('.account-settings'));
  await page.screenshot({ path: info.outputPath('account-settings.png'), fullPage: true });
  await page.getByRole('link', { name: 'Edit games, interests and profile details', exact: true }).click();
  await page.getByLabel('About me', { exact: true }).fill('A'.repeat(1000));
  await page.getByLabel('Games I play', { exact: true }).fill('Chess');
  await page.route('**/api/v1/profiles/me', route => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Save profile details', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach Dosvyazi');
  await expect(page.getByLabel('Games I play', { exact: true })).toHaveValue('Chess');
  await page.unroute('**/api/v1/profiles/me');
  await page.getByRole('button', { name: 'Save profile details', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');
  await expectReadableText(page.locator('.public-profile'));
  await changeLanguage(page, 'ru');
  await expectReadableText(page.locator('.public-profile'));
  await page.locator('main').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('personal-profile-ru.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('permission drafts survive dismissed close and reload, and moderation needs an explicit confirmation', async ({ page, browser }, info) => {
  await register(page, 'Settings owner'); await workspaceLink(page, 'Communities');
  await page.getByLabel('Community name', { exact: true }).fill('Settings crew'); await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings crew', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click(); const code = await page.getByLabel('Share this invitation code').inputValue();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const peer = await context.newPage(); await register(peer, 'Settings guest'); await workspaceLink(peer, 'Communities');
    await peer.getByLabel('Invitation code', { exact: true }).fill(code); await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'Settings crew', exact: true })).toBeVisible();
    await expect(peer.getByRole('button', { name: 'Manage access', exact: true })).toHaveCount(0);
    await page.route('**/api/v1/communities/*/members', route => route.fulfill({ status: 503, json: { title: 'Synthetic member list interruption' } }));
    await page.getByRole('button', { name: 'Manage access', exact: true }).click();
    await expect(page.locator('.access-panel').getByRole('alert')).toContainText('Synthetic member list interruption');
    await page.unroute('**/api/v1/communities/*/members');
    await page.locator('.access-panel').getByRole('button', { name: 'Retry access', exact: true }).click();
    await expect(page.getByLabel('Selected role', { exact: true })).toBeFocused();
    await page.getByLabel('New category', { exact: true }).fill('Retained category'); await page.getByRole('button', { name: 'Add category', exact: true }).click();
    await page.getByRole('button', { name: 'Close access', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Discard unsaved access changes?', exact: true });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused(); await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Close access', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Reload access', exact: true }).click(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('Voice category', { exact: true }).locator('option').filter({ hasText: 'Retained category' })).toHaveCount(1);
    await expectReadableText(page.locator('.access-editor'));
    await page.screenshot({ path: info.outputPath('access-draft.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close access', exact: true }).click(); await dialog.getByRole('button', { name: 'Discard and close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Manage access', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Manage access', exact: true }).click();
    await expect(page.getByLabel('Voice category', { exact: true }).locator('option').filter({ hasText: 'Retained category' })).toHaveCount(0);
    let removals = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/kick')) removals++; });
    const remove = page.getByRole('button', { name: 'Remove Settings guest', exact: true }); await expect(remove).toBeVisible({ timeout: 20_000 }); await remove.click();
    dialog = page.getByRole('dialog', { name: 'Remove Settings guest from the community?', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(remove).toBeFocused(); expect(removals).toBe(0);
    await remove.click(); await page.screenshot({ path: info.outputPath('remove-confirmation.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Confirm action', exact: true }).click();
    await expect(peer.getByRole('heading', { name: 'Community unavailable.', exact: true })).toBeVisible({ timeout: 20_000 }); expect(removals).toBe(1);
    await changeLanguage(page, 'ru');
    await expectReadableText(page.locator('.access-panel'));
    await page.getByLabel('Новая категория', { exact: true }).fill('Черновик категории');
    await page.getByRole('button', { name: 'Добавить категорию', exact: true }).click();
    await page.getByRole('button', { name: 'Закрыть настройки доступа', exact: true }).click();
    const translatedDialog = page.getByRole('dialog', { name: 'Отбросить несохранённые изменения прав?', exact: true });
    await expect(translatedDialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('access-confirmation-ru.png'), fullPage: true });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});

test('sticker pack details keep artwork deliberate, upload errors keep files and retirement can be dismissed', async ({ page }, info) => {
  await register(page, 'Pack designer'); await workspaceLink(page, 'Sticker packs');
  await expectReadableText(page.locator('.sticker-page'));
  await page.screenshot({ path: info.outputPath('sticker-library.png'), fullPage: true });
  await page.getByText('Create a sticker pack', { exact: true }).click();
  const unique = `layout-${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel('Unique pack name', { exact: true }).fill(unique); await page.getByLabel('Pack title', { exact: true }).fill('Layout sticker pack');
  await page.getByRole('button', { name: 'Create pack', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Layout sticker pack', exact: true })).toBeVisible();
  await expect(page.locator('.sticker-library-tools')).toHaveCount(0);
  let artwork = 0; page.on('request', request => { if (request.method() === 'GET' && /\/sticker-packs\/[^/]+\/stickers\//.test(request.url())) artwork++; });
  await page.getByLabel('Sticker label', { exact: true }).fill('Dot');
  await page.getByLabel('Sticker artwork', { exact: true }).setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2sAAAAASUVORK5CYII=', 'base64') });
  await page.route('**/sticker-packs/*/stickers', route => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Add sticker', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Cannot reach Dosvyazi');
  expect(await page.getByLabel('Sticker artwork', { exact: true }).evaluate(input => (input as HTMLInputElement).files?.[0]?.name)).toBe('dot.png');
  await page.unroute('**/sticker-packs/*/stickers'); await page.getByRole('button', { name: 'Add sticker', exact: true }).click();
  await expect(page.locator('.sticker-list')).toContainText('Dot'); expect(artwork).toBe(0);
  await expectReadableText(page.locator('.sticker-page'));
  await page.locator('main').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('sticker-pack.png'), fullPage: true });
  const retire = page.getByRole('button', { name: 'Retire pack', exact: true }); await retire.click(); await page.keyboard.press('Escape'); await expect(retire).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Layout sticker pack', exact: true })).toBeVisible();
  await retire.click(); await page.getByRole('dialog').getByRole('button', { name: 'Confirm retire pack', exact: true }).click();
  await expect(page).toHaveURL(/\/stickers$/); await expect(page.locator('.sticker-library')).not.toContainText(unique);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
