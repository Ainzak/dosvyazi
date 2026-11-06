import { expect, test } from '@playwright/test';
import { changeLanguage, workspaceLink } from './workspace-navigation';
import { matchesShortcut, plainShortcut, sameShortcut, savedShortcuts, saveShortcuts, shortcutFromEvent, shortcutLabel, validShortcut } from '../../apps/web/src/features/voice/voiceShortcuts';

test('voice shortcut storage migrates old keys and rejects corrupt or colliding saved data', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    values.set('dosvyazi-ptt-key', 'ControlRight'); expect(savedShortcuts().talk).toEqual(plainShortcut('ControlRight'));
    values.set('dosvyazi-voice-shortcuts-v1', '{broken'); expect(savedShortcuts().talk).toEqual(plainShortcut('KeyV'));
    values.set('dosvyazi-voice-shortcuts-v1', JSON.stringify({ talk: plainShortcut('KeyB'), mute: plainShortcut('KeyB') }));
    expect(savedShortcuts().mute).toBeNull();
    saveShortcuts({ talk: null, mute: plainShortcut('KeyM') }); expect(savedShortcuts()).toEqual({ talk: null, mute: plainShortcut('KeyM') });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage denied'); } });
    expect(savedShortcuts().talk).toEqual(plainShortcut('KeyV'));
    expect(() => saveShortcuts({ talk: null, mute: null })).not.toThrow();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('voice shortcut validation rejects reserved and ambiguous bindings and uses physical codes', () => {
  expect(validShortcut({ code: 'F4', ctrl: false, alt: true, shift: false })).toBe(false);
  expect(validShortcut({ code: 'KeyW', ctrl: true, alt: false, shift: false })).toBe(false);
  expect(validShortcut({ code: 'KeyV', ctrl: true, alt: true, shift: false })).toBe(false);
  expect(validShortcut({ code: 'Escape', ctrl: false, alt: false, shift: false })).toBe(false);
  expect(validShortcut({ code: 'KeyV', ctrl: 'false', alt: false, shift: false })).toBe(false);
  expect(validShortcut(plainShortcut('ControlRight'))).toBe(true);
  expect(sameShortcut(plainShortcut('KeyV'), plainShortcut('KeyB'))).toBe(false);
  expect(sameShortcut(plainShortcut('KeyV'), { ...plainShortcut('KeyV') })).toBe(true);
  const binding = { code: 'KeyV', ctrl: false, alt: false, shift: true };
  expect(shortcutLabel(binding)).toBe('Shift + V');
  const event = { code: 'KeyV', key: 'М', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, getModifierState: () => false } as unknown as KeyboardEvent;
  expect(matchesShortcut(event, binding)).toBe(true);
  expect(shortcutFromEvent({ ...event, isComposing: true } as KeyboardEvent)).toBeNull();
  expect(matchesShortcut({ ...event, metaKey: true } as KeyboardEvent, binding)).toBe(false);
});

test('custom voice shortcuts persist, guard editing and safely release on modifier loss', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Shortcuts owner');
  await page.getByLabel('Email address', { exact: true }).fill(`shortcuts-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic shortcuts owner 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Shortcuts owner.' })).toBeVisible();
  await workspaceLink(page, 'Communities');
  await page.getByLabel('Community name', { exact: true }).fill('Shortcut crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shortcut crew', exact: true })).toBeVisible();
  await workspaceLink(page, 'Voice room');
  await page.getByRole('button', { name: 'Join voice', exact: true }).click();
  const dock = page.getByRole('region', { name: /^(Voice controls|Управление голосом)$/ });
  await expect(dock).toContainText('Connected · Muted', { timeout: 20_000 });
  const panel = page.locator('#voice-settings'), toggle = dock.getByRole('button', { name: 'Audio and sharing settings', exact: true });
  await toggle.click();
  const talk = panel.getByLabel('Push-to-talk shortcut', { exact: true }), mute = panel.getByLabel('Mute/unmute shortcut', { exact: true });
  await talk.click(); await talk.press('Shift+KeyV'); await expect(talk).toHaveValue('Shift + V');
  await mute.click(); await mute.press('Shift+KeyV');
  await expect(panel.getByRole('alert')).toContainText('already assigned');
  await mute.press('Control+KeyW'); await expect(panel.getByRole('alert')).toContainText('reserved or unsupported');
  await mute.press('Escape'); await expect(panel).toBeVisible(); await expect(mute).toHaveValue('Not assigned');
  await mute.click(); await mute.press('Shift+KeyM'); await expect(mute).toHaveValue('Shift + M');
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await dock.getByRole('link').focus(); await page.keyboard.press('Shift+KeyM');
  await expect(dock.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    for (const flags of [{ repeat: true }, { isComposing: true }]) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'Ь', shiftKey: true, bubbles: true, ...flags }));
  });
  await expect(dock.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
  await page.keyboard.press('Shift+KeyM'); await expect(dock.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  await workspaceLink(page, 'general');
  const draft = page.getByLabel('Message', { exact: true }); await draft.fill('Keep my text'); await draft.press('Shift+KeyM');
  await expect(dock).toContainText('Connected · Muted');
  await dock.getByRole('button', { name: 'Deafen', exact: true }).click();
  await dock.getByRole('link').focus(); await page.keyboard.press('Shift+KeyM'); await expect(dock).toContainText('Deafened');
  await dock.getByRole('button', { name: 'Undeafen', exact: true }).click(); await expect(dock).toContainText('Connected · Muted');
  await toggle.click();
  await panel.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).check();
  await expect(panel.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  const hold = dock.getByRole('button', { name: 'Hold to talk', exact: true });
  await hold.focus(); await page.keyboard.press('Shift+KeyM'); await expect(hold).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.down('Shift'); await page.keyboard.down('KeyV');
  await expect(dock.getByRole('button', { name: 'Mute microphone', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('Shift'); await expect(hold).toHaveAttribute('aria-pressed', 'false'); await page.keyboard.up('KeyV');
  await hold.focus();
  // The physical V key works with the Russian character too.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'М', shiftKey: true, bubbles: true })));
  await expect(dock.getByRole('button', { name: 'Mute microphone', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await draft.focus(); await expect(hold).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV', key: 'М', bubbles: true })));
  await toggle.click(); await panel.getByRole('button', { name: 'Clear push-to-talk shortcut', exact: true }).click(); await expect(talk).toHaveValue('Not assigned');
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click(); await hold.focus(); await page.keyboard.press('Shift+KeyV'); await expect(hold).toHaveAttribute('aria-pressed', 'false');
  await toggle.click(); await panel.getByRole('button', { name: 'Reset microphone shortcuts', exact: true }).click();
  await expect(talk).toHaveValue('V'); await expect(mute).toHaveValue('Not assigned');
  await talk.click(); await talk.press('Shift+KeyV'); await mute.click(); await mute.press('Shift+KeyM');
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await changeLanguage(page, 'ru'); await dock.getByRole('button', { name: 'Настройки звука и трансляции', exact: true }).click();
  await page.getByLabel('Сочетание для передачи голоса', { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('shortcuts-ru.png'), fullPage: true });
  await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти из голосового канала', exact: true }).click();
  await page.reload(); await changeLanguage(page, 'en');
  await workspaceLink(page, 'Voice room'); await page.getByRole('button', { name: 'Join voice', exact: true }).click();
  await expect(dock).toContainText('Connected · Muted'); await toggle.click();
  await expect(talk).toHaveValue('Shift + V'); await expect(mute).toHaveValue('Shift + M');
  await expect(panel.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true })).toBeChecked();
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await dock.getByRole('button', { name: 'Leave voice', exact: true }).click();
});
