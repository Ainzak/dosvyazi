import type { Locator, Page } from '@playwright/test';

// The same navigation is persistent on desktop and opened explicitly on phones.
export async function workspaceLink(page: Page, name: string) {
  await openWorkspaceNavigation(page);
  await page.getByRole('link', { name, exact: true }).click();
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
  if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
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

export async function confirmPendingAction(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm action', exact: true }).click();
}

export async function joinVoice(page: Page) {
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
