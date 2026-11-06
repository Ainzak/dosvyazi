import { expect, test } from '@playwright/test';
import { changeLanguage, closeWorkspaceNavigation, openWorkspaceNavigation } from './workspace-navigation';

test('context navigation, time-only invitation dialog and discoverable voice creation', async ({ page, browser }, info) => {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Navigation owner');
  await page.getByLabel('Email address', { exact: true }).fill(`nav-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic navigation passphrase 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Navigation owner.' })).toBeVisible();
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Context navigation');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Context navigation', exact: true })).toBeVisible();
  await page.route('**/api/v1/communities/*/invites', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(); const data = await response.json() as unknown[];
    await route.fulfill({ response, json: [...data,
      { id: crypto.randomUUID(), maxUses: null, uses: 0, expiresAt: '2020-01-01T00:00:00Z', revoked: false },
      { id: crypto.randomUUID(), maxUses: null, uses: 0, expiresAt: '2099-01-01T00:00:00Z', revoked: true },
    ] });
  });
  await openWorkspaceNavigation(page);
  await expect(page.getByRole('link', { name: 'Messages', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My bookmarks', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite people', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite people', exact: true });
  await expect(dialog.getByLabel('Maximum uses')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(dialog.getByLabel('Invitation link')).toHaveValue(/\/invite\/[a-f0-9]{64}$/);
  await expect(dialog.getByRole('button', { name: /^Revoke invitation/ })).toHaveCount(1);
  const url = await dialog.getByLabel('Invitation link').inputValue();
  await dialog.screenshot({ path: info.outputPath('invite-dialog.png') });
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Create voice channel', exact: true }).click();
  const creation = page.getByRole('dialog', { name: 'Create voice channel', exact: true });
  await creation.getByLabel('Channel name', { exact: true }).fill('Movie room');
  await creation.getByRole('button', { name: 'Create voice channel', exact: true }).click();
  await expect(page).toHaveURL(/\/voice\/[a-f0-9-]+$/);
  await closeWorkspaceNavigation(page); await expect(creation).not.toBeVisible();
  await openWorkspaceNavigation(page); await expect(page.getByRole('link', { name: 'Movie room', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Dosvyazi home', exact: true }).click(); await openWorkspaceNavigation(page);
  await expect(page.getByRole('link', { name: 'Messages', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'My bookmarks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My bookmarks', exact: true })).toBeVisible();
  await expect(page.getByText('Your saved messages from all communities and personal conversations. Only you can see this collection.')).toBeVisible();
  await page.goto(url); await expect(page.getByRole('heading', { name: 'Community invitation', exact: true })).toBeVisible();
  // A GET invitation link must never mutate membership automatically.
  await expect(page.getByRole('button', { name: 'Join community', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('invitation-page.png'), fullPage: true });
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const guest = await context.newPage(); await guest.goto(url);
    await guest.getByRole('link', { name: 'Create account', exact: true }).click();
    await guest.getByLabel('Display name', { exact: true }).fill('Invitation recipient');
    await guest.getByLabel('Email address', { exact: true }).fill(`invited-${crypto.randomUUID()}@example.test`);
    await guest.getByLabel('Password', { exact: true }).fill('Synthetic invitation passphrase 42');
    await guest.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(guest).toHaveURL(url);
    expect(await (await guest.request.get('/api/v1/communities')).json()).toEqual([]);
    await guest.getByRole('button', { name: 'Join community', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Context navigation', exact: true })).toBeVisible();
    await openWorkspaceNavigation(guest);
    await expect(guest.getByRole('button', { name: 'Invite people', exact: true })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Create voice channel', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
  await page.goto(url.replace(/\/invite\/.*/, '')); await changeLanguage(page, 'ru');
  // Open the existing community via its rail; Russian wording and local previews
  // are checked separately from the English workflow above.
  const communities = await (await page.request.get('/api/v1/communities')).json() as { id: string }[];
  await page.goto(`/communities/${communities[0]!.id}`); await openWorkspaceNavigation(page);
  await expect(page.getByRole('link', { name: 'Сообщения', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Создать голосовой канал', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('community-navigation-ru.png') });
  await page.getByRole('button', { name: 'Пригласить участников', exact: true }).click();
  await page.getByRole('dialog', { name: 'Пригласить участников', exact: true }).getByRole('button', { name: 'Создать приглашение', exact: true }).click();
  await expect(page.getByLabel('Ссылка-приглашение', { exact: true })).toHaveValue(/\/invite\/[a-f0-9]{64}$/);
  await page.getByRole('dialog', { name: 'Пригласить участников', exact: true }).screenshot({ path: info.outputPath('invite-dialog-ru.png') });
});
