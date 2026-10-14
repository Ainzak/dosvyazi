import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`voice-message-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic voice message 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function channel(page: Page) {
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Voice notes crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Voice notes crew' })).toBeVisible();
  await page.getByRole('link', { name: 'general', exact: true }).click(); await expect(page.getByRole('heading', { name: '#general' })).toBeVisible();
}

test('synthetic microphone records a finite preview and private playable message with deletion cleanup', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await register(page, 'Voice note author'); await channel(page);
  await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
  await expect(page.getByText('Recording your microphone: 1s', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const preview = page.getByLabel('Voice message preview', { exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(element => Number.isFinite((element as HTMLAudioElement).duration) && (element as HTMLAudioElement).duration > 0)).toBe(true);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load voice message', exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: 'Load voice message', exact: true }).click();
  const player = page.getByLabel('Voice message playback', { exact: true });
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate(element => Number.isFinite((element as HTMLAudioElement).duration) && (element as HTMLAudioElement).duration > 0 && (element as HTMLAudioElement).duration < 5)).toBe(true);
  await player.evaluate(async element => { const audio = element as HTMLAudioElement; await audio.play(); });
  await expect.poll(() => player.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await player.evaluate(element => { const audio = element as HTMLAudioElement; audio.pause(); audio.currentTime = audio.duration / 2; });
  await page.screenshot({ path: info.outputPath('voice-message-player.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close voice message', exact: true }).click();
  await expect(player).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button', { name: 'Load voice message', exact: true })).toBeVisible();
  const row = page.locator('.message-list > li').first();
  await row.getByRole('button', { name: 'Delete message by Voice note author', exact: true }).click();
  await row.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load voice message', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('cancelled recording never sends and denied microphone keeps text usable', async ({ page }) => {
  await register(page, 'Voice cancel author'); await channel(page);
  await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
  await expect(page.getByText('Recording your microphone: 0s', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record voice message', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Voice message preview', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Synthetic denial', 'NotAllowedError')); });
  await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
  await expect(page.getByText('Microphone unavailable. Allow microphone access and try again.', { exact: true })).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Text still works after recording denial');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.message-list')).toContainText('Text still works after recording denial');
});

test('lost send acknowledgement retains voice draft and retry produces one message', async ({ page }) => {
  await register(page, 'Voice retry author'); await channel(page);
  await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
  await expect(page.getByText('Recording your microphone: 1s', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByLabel('Voice message preview', { exact: true })).toBeVisible();
  const requests: string[] = []; let lost = false;
  await page.route('**/voice-messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const content = route.request().postDataBuffer()!.toString('utf8');
    const id = content.match(/name="clientMessageId"\r\n\r\n([^\r]+)/)?.[1]; expect(id).toBeTruthy(); requests.push(id!);
    if (!lost) { lost = true; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort(); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry send', exact: true })).toBeVisible();
  await expect(page.getByLabel('Voice message preview', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry send', exact: true }).click();
  await expect(page.getByLabel('Voice message preview', { exact: true })).toHaveCount(0);
  await expect(page.locator('.message-list > li')).toHaveCount(1);
  expect(requests).toHaveLength(2); expect(requests[0]).toBe(requests[1]);
});

test('unsupported recorder is explained and late microphone permission stops after navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const fixture = { resume: null as (() => void) | null, tracks: [] as MediaStreamTrack[] };
    (window as unknown as { recordingFixture: typeof fixture }).recordingFixture = fixture;
    navigator.mediaDevices.getUserMedia = async options => {
      await new Promise<void>(resolve => { fixture.resume = resolve; });
      const stream = await original(options); fixture.tracks.push(...stream.getTracks()); return stream;
    };
  });
  await register(page, 'Voice permission author'); await channel(page);
  await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
  await expect(page.getByText('Waiting for microphone permission…', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.evaluate(() => { (window as unknown as { recordingFixture: { resume: (() => void) | null } }).recordingFixture.resume!(); });
  await expect.poll(() => page.evaluate(() => {
    const tracks = (window as unknown as { recordingFixture: { tracks: MediaStreamTrack[] } }).recordingFixture.tracks;
    return tracks.length > 0 && tracks.every(track => track.readyState === 'ended');
  })).toBe(true);
  await page.evaluate(() => { MediaRecorder.isTypeSupported = () => false; });
  await page.goBack();
  await expect(page.getByText('Voice recording is unavailable in this browser. Text and file messages still work.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record voice message', exact: true })).toBeDisabled();
});
