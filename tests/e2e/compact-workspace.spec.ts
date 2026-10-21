import { expect, test } from '@playwright/test';
import { changeLanguage, composerTools, joinVoice, openWorkspaceNavigation, workspaceLink } from './workspace-navigation';
import { expectReadableText } from './readability';

test('compact conversation keeps header tools and inline composer accessible without dropping drafts or voice', async ({ page }, info) => {
  await page.addInitScript(() => {
    // Synthetic source picker only; publication still uses the real local SFU.
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const brush = canvas.getContext('2d')!;
      const draw = () => {
        brush.fillStyle = '#151a20'; brush.fillRect(0, 0, 960, 540);
        brush.fillStyle = '#8de3c2'; brush.font = 'bold 32px sans-serif'; brush.fillText('Night Crew', 44, 66);
        brush.fillStyle = '#303d49'; brush.fillRect(44, 100, 872, 2);
        brush.fillStyle = '#eef1f5'; brush.font = '24px sans-serif'; brush.fillText('Tonight: one more round together', 44, 155);
        for (let i = 0; i < 3; i++) { brush.fillStyle = i % 2 ? '#27313b' : '#202932'; brush.fillRect(44, 204 + i * 80, 872, 60); }
        requestAnimationFrame(draw);
      };
      draw(); return canvas.captureStream(10);
    };
  });
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Alex');
  await page.getByLabel('Email address', { exact: true }).fill(`compact-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic compact workspace 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Alex.' })).toBeVisible();
  await workspaceLink(page, 'Communities');
  await page.getByLabel('Community name', { exact: true }).fill('Night Crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Night Crew', exact: true })).toBeVisible();
  await workspaceLink(page, 'general');
  const input = page.getByLabel('Message', { exact: true });
  for (const message of ['Anyone up for a game tonight?', 'We can start at eight. I will share the plan here.', 'Screen sharing is ready. Let’s keep the conversation going.', 'Perfect. Give me five minutes and I’ll join you.']) {
    await input.fill(message); await input.press('Enter'); await expect(input).toHaveValue('');
  }
  let joins = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/voice/join')) joins++; });
  await joinVoice(page);
  const dock = page.getByRole('region', { name: 'Voice controls', exact: true });
  await expect(dock).toContainText('Connected · Muted', { timeout: 20_000 });
  await workspaceLink(page, 'general');
  await input.fill('I’m ready when you are.');
  const header = page.locator('.workspace-topbar');
  await expect(header.getByRole('button', { name: 'Search this channel', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Mark as read', exact: true })).toBeVisible();
  await expect(header.getByRole('link')).toHaveCount(0);
  const field = await page.locator('.composer-input-row').boundingBox();
  for (const name of ['Insert emoji', 'Stickers', 'Attach / record', 'Send message']) {
    const button = page.getByRole('button', { name, exact: true }); const box = await button.boundingBox();
    expect(box && field && box.y >= field.y && box.y + box.height <= field.y + field.height).toBe(true);
  }
  expect((await page.locator('.message-composer').boundingBox())!.height).toBeLessThan(90);
  const controls = await dock.locator('.voice-actions > .icon-button').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().y)));
  expect(new Set(controls).size).toBe(1); expect(controls).toHaveLength(6);
  await page.getByRole('button', { name: 'Insert emoji', exact: true }).click();
  await page.getByRole('button', { name: 'Insert emoji 👍', exact: true }).click();
  await expect(input).toHaveValue('I’m ready when you are.👍');
  await composerTools(page);
  await expect(page.getByRole('region', { name: 'Attachments and recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close attachments', exact: true }).click();
  await changeLanguage(page, 'ru');
  await expect(page.getByLabel('Сообщение', { exact: true })).toHaveValue('I’m ready when you are.👍');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  expect(joins).toBe(1);
  await expectReadableText(page.locator('.message-list'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Сообщение', { exact: true }).focus();
  await page.screenshot({ path: info.outputPath('compact-chat-ru.png'), fullPage: true });
  await page.getByRole('button', { name: 'Поделиться экраном', exact: true }).click();
  await page.getByRole('button', { name: 'Смотреть видео (1)', exact: true }).click();
  const video = page.locator('.voice-videos video'); await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('compact-chat-screen-ru.png'), fullPage: true });
  await page.getByRole('button', { name: 'Остановить показ', exact: true }).click();
  await openWorkspaceNavigation(page);
  await expect(page.getByRole('link', { name: 'Мой аккаунт', exact: true })).toHaveCount(1);
  await page.getByRole('link', { name: 'Мой аккаунт', exact: true }).click();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти из голосового канала', exact: true }).click();
});
