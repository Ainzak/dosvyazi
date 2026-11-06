import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

// The same navigation is persistent on desktop and opened explicitly on phones.
export async function workspaceLink(page: Page, name: string) {
  await openWorkspaceNavigation(page);
  let link = page.getByRole('link', { name, exact: true });
  if (!await link.isVisible() && ['Messages', 'Communities', 'Sticker packs', 'Notifications', 'Bookmarks', 'My bookmarks'].includes(name)) {
    await page.getByRole('link', { name: 'Dosvyazi home', exact: true }).click(); await openWorkspaceNavigation(page);
  }
  if (name === 'Bookmarks') link = page.getByRole('link', { name: 'My bookmarks', exact: true });
  await link.click();
}

export async function openWorkspaceNavigation(page: Page) {
  const menu = page.getByRole('button', { name: /^(Open navigation|Открыть навигацию)$/ });
  const drawer = page.getByRole('dialog', { name: /^(Workspace navigation|Навигация)$/ });
  if (await menu.isVisible() && !await drawer.isVisible()) await menu.click();
}

export async function closeWorkspaceNavigation(page: Page) {
  if (await page.getByRole('dialog', { name: /^(Workspace navigation|Навигация)$/ }).isVisible()) await page.keyboard.press('Escape');
}

export async function audioSettings(page: Page) {
  const settings = page.getByRole('button', { name: 'Audio and sharing settings', exact: true });
  // Native popover close is synchronous; its React toggle/ARIA update is queued.
  // Observe actual visibility when reopening immediately after an outside action.
  const panel = page.locator('#voice-settings');
  if (!await panel.isVisible()) await settings.click();
  await expect(panel).toBeVisible();
}

export async function startScreenShare(page: Page, audio?: boolean) {
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share your screen', exact: true });
  if (audio !== undefined) await dialog.getByRole('checkbox', { name: 'Include screen audio when available', exact: true }).setChecked(audio);
  await dialog.getByRole('button', { name: 'Choose source', exact: true }).click();
}

export async function composerTools(page: Page) {
  const trigger = page.getByRole('button', { name: /^(Attach \/ record|Файл \/ запись)$/ });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}

export async function messageAction(scope: Page | Locator, name: string) {
  const page = 'page' in scope ? scope.page() : scope;
  const action = scope.getByRole('button', { name, exact: true });
  if (!await action.isVisible()) await scope.locator('.message-action-menu').filter({ has: page.getByRole('button', { name, exact: true, includeHidden: true }) }).locator('summary').click();
  await action.click();
}

export async function communityOverview(page: Page) {
  if (/^\/communities\/[^/]+\/?$/.test(new URL(page.url()).pathname)) return;
  await workspaceLink(page, 'Community overview');
}

export async function createInvitation(page: Page) {
  await communityOverview(page); await openWorkspaceNavigation(page);
  await page.getByRole('button', { name: 'Invite people', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite people', exact: true });
  await dialog.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(dialog.getByLabel('Invitation link', { exact: true })).toHaveValue(/\/invite\/[a-f0-9]{64}$/);
  const link = await dialog.getByLabel('Invitation link', { exact: true }).inputValue();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await closeWorkspaceNavigation(page);
  return new URL(link).pathname.split('/').at(-1)!;
}

export async function confirmPendingAction(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
}

export async function joinVoice(page: Page) {
  // A community-join mutation can still be awaiting its response. Opening the
  // mobile drawer before that navigation completes correctly closes it again.
  if (/^\/communities\/?$/.test(new URL(page.url()).pathname)) await expect(page).toHaveURL(/\/communities\/[^/]+/);
  const button = page.getByRole('button', { name: 'Join voice', exact: true });
  if (!await button.isVisible()) await workspaceLink(page, 'Voice room');
  await button.click();
}

export async function channelSearch(page: Page) {
  const trigger = page.getByRole('button', { name: /^(Search this channel|Поиск в этом канале)$/ });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}

export async function changeLanguage(page: Page, locale: 'en' | 'ru') {
  const language = page.getByRole('button', { name: locale === 'ru' ? 'Русский' : 'English', exact: true });
  if (await language.isVisible()) { await language.click(); return; }
  const drawer = page.getByRole('dialog', { name: /^(Workspace navigation|Навигация)$/ });
  const wasOpen = await drawer.isVisible();
  await openWorkspaceNavigation(page);
  const options = page.getByRole('button', { name: /^(Account options|Настройки аккаунта)$/ });
  await options.click();
  await language.click();
  await options.press('Escape');
  if (!wasOpen) await closeWorkspaceNavigation(page);
}
