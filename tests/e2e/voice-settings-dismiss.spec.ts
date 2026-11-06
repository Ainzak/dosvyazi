import { expect, test } from '@playwright/test';
import { workspaceLink } from './workspace-navigation';

for (const fallback of [false, true]) test(`voice settings dismiss across main content and stopped bubbling (${fallback ? 'fallback' : 'native'})`, async ({ page }, info) => {
  if (fallback) await page.addInitScript(() => { Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: undefined, configurable: true }); });
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Settings owner');
  await page.getByLabel('Email address', { exact: true }).fill(`dismiss-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic settings owner 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Settings owner.' })).toBeVisible();
  await workspaceLink(page, 'Communities');
  await page.getByLabel('Community name', { exact: true }).fill('Dismiss crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dismiss crew', exact: true })).toBeVisible();
  await workspaceLink(page, 'Voice room');
  await page.getByRole('button', { name: 'Join voice', exact: true }).click();
  const dock = page.getByRole('region', { name: 'Voice controls', exact: true });
  await expect(dock).toContainText('Connected · Muted', { timeout: 20_000 });
  await workspaceLink(page, 'general');
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Retained settings dismissal draft');
  const panel = page.locator('#voice-settings');
  const toggle = dock.getByRole('button', { name: 'Audio and sharing settings', exact: true });
  await toggle.click(); await expect(panel).toBeVisible();
  expect(await panel.evaluate(e => e.matches(':popover-open'))).toBe(!fallback);
  await panel.getByRole('checkbox', { name: 'Include screen audio when available', exact: true }).check();
  await expect(panel).toBeVisible();
  // Use an exposed header area, not an element underneath the tall panel.
  if (info.project.name === 'mobile') await page.touchscreen.tap(page.viewportSize()!.width - 8, 8);
  else await page.mouse.click(page.viewportSize()!.width - 8, 8);
  await expect(panel).toBeHidden(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(draft).toHaveValue('Retained settings dismissal draft');
  await toggle.click(); await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close settings', exact: true }).press('Escape');
  await expect(panel).toBeHidden(); await expect(toggle).toBeFocused();
  await toggle.click(); await expect(panel).toBeVisible();
  await toggle.click(); await expect(panel).toBeHidden();
  if (!fallback) {
    await toggle.click(); await expect(panel).toBeVisible();
    // Nested widgets may stop bubbling; native browser dismissal must still work.
    await panel.evaluate(element => element.addEventListener('keydown', e => e.stopPropagation()));
    await panel.getByRole('button', { name: 'Close settings', exact: true }).press('Escape');
    await expect(panel).toBeHidden(); await expect(toggle).toBeFocused();
  }
  await toggle.click(); await expect(panel).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: 'Include screen audio when available', exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath('settings-open.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(dock).toContainText('Connected · Muted');
  await dock.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await expect(panel).toHaveCount(0);
});
