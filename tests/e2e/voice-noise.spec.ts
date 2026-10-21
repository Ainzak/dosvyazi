import { changeLanguage, audioSettings, joinVoice } from './workspace-navigation';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    noiseTest: { tracks: MediaStreamTrack[]; captures: number; fail: boolean; hold: boolean; holdCapture: boolean; ignore: boolean; release?: () => void };
  }
}

async function setup(page: Page, supported = true) {
  await page.addInitScript(({ supported }) => {
    window.noiseTest = { tracks: [], captures: 0, fail: false, hold: false, holdCapture: false, ignore: false };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(window.noiseTest.ignore ? { ...constraints, audio: { noiseSuppression: true } } : constraints);
      if (constraints?.audio) { window.noiseTest.captures++; window.noiseTest.tracks.push(...stream.getAudioTracks()); }
      if (window.noiseTest.holdCapture) await new Promise<void>(resolve => { window.noiseTest.release = resolve; });
      return stream;
    };
    const supportedConstraints = navigator.mediaDevices.getSupportedConstraints.bind(navigator.mediaDevices);
    navigator.mediaDevices.getSupportedConstraints = () => ({ ...supportedConstraints(), noiseSuppression: supported });
    const apply = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = async function (constraints) {
      if (constraints?.noiseSuppression !== undefined) {
        if (window.noiseTest.fail) throw new DOMException('Synthetic processing rejection', 'OverconstrainedError');
        if (window.noiseTest.hold) await new Promise<void>(resolve => { window.noiseTest.release = resolve; });
        if (window.noiseTest.ignore) return;
      }
      return apply.call(this, constraints);
    };
  }, { supported });
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill('Noise controls');
  await page.getByLabel('Email address', { exact: true }).fill(`noise-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic microphone controls 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Noise controls.' })).toBeVisible();
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Noise controls crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Noise controls crew', exact: true })).toBeVisible();
  await join(page);
}
async function join(page: Page) {
  await joinVoice(page);
  // Initial ICE admission is a separate bounded phase, before processing assertions.
  await expect(page.getByRole('region', { name: 'Voice controls', exact: true }).getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Voice controls', exact: true })).toContainText('Connected');
  await audioSettings(page);
}
const setting = (page: Page) => page.evaluate(() => window.noiseTest.tracks.at(-1)?.getSettings().noiseSuppression);
const captures = (page: Page) => page.evaluate(() => window.noiseTest.captures);

test('noise suppression preference persists and processing changes preserve mute, deafen and devices', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  const toggle = page.getByRole('checkbox', { name: 'Noise suppression', exact: true });
  await expect(toggle).toBeChecked(); await toggle.uncheck(); expect(await captures(page)).toBe(0);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
  await page.reload(); await join(page); await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
  await expect.poll(() => setting(page)).toBe(false);
  const initial = await page.evaluate(() => window.noiseTest.tracks.at(-1)!.getSettings());
  const captureCount = await captures(page);
  await toggle.check(); await expect.poll(() => setting(page)).toBe(true);
  expect(await captures(page)).toBeLessThanOrEqual(captureCount + 1);
  expect(await page.evaluate(() => window.noiseTest.tracks.filter(track => track.readyState === 'live').length)).toBe(1);
  const changed = await page.evaluate(() => window.noiseTest.tracks.at(-1)!.getSettings());
  expect(changed.deviceId).toBe(initial.deviceId); expect(changed.echoCancellation).toBe(initial.echoCancellation);
  expect(changed.autoGainControl).toBe(initial.autoGainControl);
  await page.evaluate(() => { window.noiseTest.fail = true; }); await toggle.uncheck();
  await expect(page.getByText('Noise suppression could not be changed. Your microphone keeps its previous setting.', { exact: true })).toBeVisible();
  expect(await setting(page)).toBe(true); await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.noiseTest.fail = false; }); await page.getByRole('button', { name: 'Retry noise suppression', exact: true }).click();
  await expect.poll(() => setting(page)).toBe(false); await expect(page.getByRole('button', { name: 'Retry noise suppression', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Deafen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undeafen', exact: true })).toBeEnabled();
  const mutedCaptures = await captures(page);
  await toggle.check(); await expect(toggle).toBeEnabled();
  expect(await captures(page)).toBe(mutedCaptures);
  expect(await page.evaluate(() => window.noiseTest.tracks.at(-1)!.enabled)).toBe(false);
  await page.getByRole('button', { name: 'Undeafen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
  await expect.poll(() => setting(page)).toBe(true);
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('noise-controls.png'), fullPage: true });
  await changeLanguage(page, 'ru');
  await expect(page.getByRole('checkbox', { name: 'Шумоподавление', exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath('noise-controls-ru.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a late microphone refresh is discarded after muting and leaving', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect.poll(() => setting(page)).toBe(true);
  await page.evaluate(() => { window.noiseTest.holdCapture = true; });
  await page.getByRole('checkbox', { name: 'Noise suppression', exact: true }).uncheck();
  await expect.poll(() => captures(page)).toBe(2);
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
  await page.evaluate(() => { window.noiseTest.release?.(); });
  await expect.poll(() => page.evaluate(() => window.noiseTest.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
  expect(await captures(page)).toBe(2);
});

test('unsupported noise suppression is explained without preventing explicit microphone use', async ({ page }, info) => {
  await setup(page, false);
  await expect(page.getByRole('checkbox', { name: 'Noise suppression', exact: true })).toBeDisabled();
  await expect(page.getByText('Noise suppression is unavailable in this browser.', { exact: true })).toBeVisible();
  expect(await captures(page)).toBe(0);
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('noise-unsupported.png'), fullPage: true });
});

test('unconfirmed refreshed capture leaves the microphone muted and explicit activation recovers', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect.poll(() => setting(page)).toBe(true);
  const toggle = page.getByRole('checkbox', { name: 'Noise suppression', exact: true });
  await page.evaluate(() => { window.noiseTest.ignore = true; }); await toggle.uncheck();
  await expect(page.getByText('Microphone refresh failed. Your microphone is muted. Enable it to try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.noiseTest.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => { window.noiseTest.ignore = false; });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect.poll(() => setting(page)).toBe(false);
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
});

test('a late constraint result cannot unmute or restore a departed session', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect.poll(() => setting(page)).toBe(true);
  await page.evaluate(() => { window.noiseTest.hold = true; });
  await page.getByRole('checkbox', { name: 'Noise suppression', exact: true }).uncheck();
  await expect(page.getByText('Applying noise suppression…', { exact: true })).toBeVisible();
  // A slow processing setting must not lock the mute/deafen controls.
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  const captureCount = await captures(page);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
  await page.evaluate(() => { window.noiseTest.release?.(); });
  await expect.poll(() => page.evaluate(() => window.noiseTest.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  expect(await captures(page)).toBe(captureCount);
  await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
  await expect(page.getByText('Noise suppression could not be changed. Your microphone keeps its previous setting.', { exact: true })).toHaveCount(0);
});
