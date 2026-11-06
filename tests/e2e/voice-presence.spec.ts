import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { VoiceState } from '../../apps/web/src/api/voice';
import { orderedVoiceMembers } from '../../apps/web/src/features/voice/participantOrder';
import { createInvitation, audioSettings, changeLanguage, joinVoice, workspaceLink } from './workspace-navigation';
test.use({ serviceWorkers: 'block' });

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`presence-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic presence passphrase 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
test('voice order is deterministic with duplicate names and does not mutate polling snapshots', () => {
  const row = (identity: string, displayName: string) => ({ identity, displayName, speakingAllowed: true, audioTracks: 0 });
  const rows = [row('z', 'Same'), row('c', 'Beta'), row('a', 'same'), row('b', 'Alpha')];
  const original = [...rows];
  expect(orderedVoiceMembers(rows).map(r => r.identity)).toEqual(['b', 'c', 'a', 'z']);
  expect(orderedVoiceMembers([...rows].reverse()).map(r => r.identity)).toEqual(['b', 'c', 'a', 'z']);
  expect(rows).toEqual(original);
});
test('remote mute state follows the microphone and order survives shuffled polls and audio changes', async ({ page, browser, context }, info) => {
  test.setTimeout(90_000);
  await context.grantPermissions(['microphone', 'camera']);
  let joins = 0, polls = 0;
  page.on('response', r => { if (r.status() === 200 && r.request().method() === 'POST' && r.url().endsWith('/voice/join')) joins++; });
  await page.route(/\/api\/v1\/communities\/[^/]+\/voice(?:\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch();
    if (response.status() !== 200) { await route.fulfill({ response }); return; }
    const state = await response.json() as VoiceState;
    if (++polls % 2 === 0) state.participants.reverse();
    // Track count cannot tell whether an already-published microphone is muted.
    state.participants = state.participants.map(m => ({ ...m, audioTracks: 0 }));
    await route.fulfill({ response, json: state });
  });
  await register(page, 'Zed owner'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Presence room');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  const invitation = await createInvitation(page);
  const peerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  try {
    const peer = await peerContext.newPage(); await register(peer, 'Alex member'); await peer.goto('/communities');
    await peer.getByLabel('Invitation code', { exact: true }).fill(invitation);
    await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await joinVoice(peer); await expect(peer.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 });
    await workspaceLink(page, 'Voice room');
    const people = page.getByRole('list', { name: /^(Participants in voice|Участники голосового канала)$/ });
    const alex = people.getByRole('listitem').filter({ hasText: 'Alex member' });
    await expect(alex).toContainText('Microphone status unavailable');
    await joinVoice(page); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 });
    await expect(alex).toContainText('Microphone muted');
    await expect(alex.locator('.lucide-mic-off')).toBeVisible();
    const names = people.locator('.voice-participant-name');
    await expect(names).toHaveText(['Alex member', 'Zed owner · You']);
    const initialPolls = polls;
    await peer.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect(alex).not.toContainText('Microphone muted');
    await expect(alex.locator('.lucide-mic')).toBeVisible();
    await expect(names).toHaveText(['Alex member', 'Zed owner · You']);
    await peer.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await expect(alex).toContainText('Microphone muted');
    await expect.poll(() => polls).toBeGreaterThan(initialPolls + 2);
    await expect(names).toHaveText(['Alex member', 'Zed owner · You']);
    await peer.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(alex).toContainText('Microphone muted');
    await peer.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await peer.getByRole('button', { name: 'Deafen', exact: true }).click();
    await expect(alex).toContainText('Microphone muted');
    await peer.getByRole('button', { name: 'Undeafen', exact: true }).click();
    await expect(alex).not.toContainText('Microphone muted');
    await peer.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await audioSettings(peer);
    await peer.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).check();
    await expect(peer.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true })).toBeEnabled();
    await peer.getByRole('button', { name: 'Close settings', exact: true }).click();
    await peer.getByRole('button', { name: 'Hold to talk', exact: true }).focus();
    await peer.keyboard.down('KeyV');
    await expect(alex).not.toContainText('Microphone muted');
    await peer.keyboard.up('KeyV');
    await expect(alex).toContainText('Microphone muted');
    await changeLanguage(page, 'ru');
    await expect(alex).toContainText('Микрофон выключен');
    await page.screenshot({ path: info.outputPath('remote-muted-ru.png'), fullPage: true });
    await expect(names).toHaveText(['Alex member', 'Zed owner · Вы']);
    expect(joins).toBe(1);
    await peer.getByRole('button', { name: 'Leave voice', exact: true }).click();
    await expect(alex).toHaveCount(0); expect(joins).toBe(1);
  } finally {
    // Drain in-flight polling interceptions before Playwright disposes the response context.
    await page.unrouteAll({ behavior: 'wait' });
    await peerContext.close();
  }
});
