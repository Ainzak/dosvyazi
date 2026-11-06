import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { ConnectionCounter } from '../../apps/web/src/features/voice/connectionStats';
import { screenIntent } from '../../apps/web/src/features/voice/mediaQuality';
import { createInvitation, audioSettings, changeLanguage, communityOverview, joinVoice, startScreenShare } from './workspace-navigation';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream=device-count=4,fps=60', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
declare global { interface Window { motionFixture: { mic: MediaStreamTrack[]; camera: MediaStreamTrack[]; screen: MediaStreamTrack[]; pcs: RTCPeerConnection[]; reject: boolean; ignore: boolean; hold: boolean; releases: (() => void)[] } } }
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const f = window.motionFixture = { mic: [], camera: [], screen: [], pcs: [], reject: false, ignore: false, hold: false, releases: [] } as Window['motionFixture'];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await capture(options); if (options?.audio) f.mic.push(...stream.getAudioTracks()); if (options?.video) f.camera.push(...stream.getVideoTracks()); return stream; };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const stream = await capture({ audio: false, video: { deviceId: { exact: devices.at(-1)!.deviceId }, width: 2560, height: 1440, frameRate: 60 } }); f.screen.push(...stream.getVideoTracks()); return stream;
    };
    const set = RTCRtpSender.prototype.setParameters;
    RTCRtpSender.prototype.setParameters = async function (parameters) {
      if (this.track === f.screen.at(-1) && parameters.degradationPreference === 'maintain-framerate') {
        if (f.hold) await new Promise<void>(resolve => f.releases.push(resolve));
        if (f.reject) throw new DOMException('Synthetic sender failure', 'OperationError');
        if (f.ignore) return;
      }
      return set.call(this, parameters);
    };
    const Native = RTCPeerConnection; window.RTCPeerConnection = class extends Native { constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) { super(...args); f.pcs.push(this); } };
  });
}
async function register(page: Page, name: string) {
  await fixture(page); await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name); await page.getByLabel('Email address', { exact: true }).fill(`motion-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic screen motion 42'); await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function setup(page: Page) {
  await register(page, 'Motion owner'); await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Motion crew'); await page.getByRole('button', { name: 'Create community', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Motion crew', exact: true })).toBeVisible();
}
async function joined(page: Page) { await joinVoice(page); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 }); }
async function priority(page: Page, value: string) { await audioSettings(page); const select = page.getByLabel('Screen content priority', { exact: true }); await select.selectOption(value); await expect(select).toBeEnabled(); }
const state = (page: Page) => page.evaluate(() => {
  const f = window.motionFixture, track = f.screen.at(-1), sender = f.pcs.flatMap(pc => pc.getSenders()).find(sender => sender.track === track), parameters = sender?.getParameters();
  return { id: track?.id, hint: track?.contentHint, ready: track?.readyState, settings: track?.getSettings(), preference: parameters?.degradationPreference, encoding: parameters?.encodings[0], peers: f.pcs.length, microphone: f.mic.at(-1)?.id, camera: f.camera.at(-1)?.id };
});
async function frames(page: Page, direction: 'inbound-rtp' | 'outbound-rtp') {
  return page.evaluate(async direction => (await Promise.all(window.motionFixture.pcs.map(pc => pc.getStats()))).flatMap(report => [...report.values()]).filter(row => row.type === direction && row.kind === 'video').reduce((sum, row) => sum + Number(row.framesEncoded ?? row.framesDecoded ?? 0), 0), direction);
}

test('video diagnostics calculate interval costs and drops, reject stale/reset/gap counters, and export only safe fields', () => {
  const report = (rows: Record<string, unknown>[]) => new Map(rows.map(r => [r.id, r])) as unknown as RTCStatsReport;
  const c = new ConnectionCounter(0);
  const outbound = (timestamp: number, frames: number, time: number, reason = 'cpu') => ({ type: 'outbound-rtp', id: 'private-stream', kind: 'video', bytesSent: frames * 100, timestamp, framesEncoded: frames, totalEncodeTime: time, qualityLimitationReason: reason, mediaSourceId: 'source', address: 'private-ip', frameWidth: Infinity });
  const source = (frames: number) => ({ id: 'source', type: 'media-source', frames });
  expect(c.sample([report([outbound(1000, 10, .1), source(20)])], 1000).videos[0]).toMatchObject({ interval: 'baseline', processingMsPerFrame: null, captureFps: null, width: null });
  const rows = report([outbound(3000, 40, .25), source(80)]), v = c.sample([rows, rows], 3000).videos;
  expect(v).toHaveLength(1); expect(v[0]).toMatchObject({ fps: 15, captureFps: 30, processingMsPerFrame: 5, limitation: 'cpu', intervalSeconds: 2, interval: 'updating' });
  expect(c.sample([rows], 5000).videos[0]).toMatchObject({ interval: 'stale', processingMsPerFrame: null, fps: null, limitation: null });
  expect(c.sample([report([outbound(6000, 2, .01), source(2)])], 6000).videos[0]).toMatchObject({ interval: 'reset', processingMsPerFrame: null, fps: null });
  c.sample([], 7000); expect(c.sample([report([outbound(8000, 10, .02, 'private-ip')])], 8000).videos[0]).toMatchObject({ interval: 'baseline', fps: null, limitation: null });
  const inbound = (timestamp: number, frames: number, dropped: number, freezes: number, frozen: number, time: number) => ({ id: 'receiver', type: 'inbound-rtp', kind: 'video', timestamp, bytesReceived: frames * 20, framesDecoded: frames, framesDropped: dropped, freezeCount: freezes, totalFreezesDuration: frozen, totalDecodeTime: time });
  c.sample([report([inbound(9000, 10, 1, 0, 0, .02)])], 9000);
  const received = c.sample([report([inbound(11000, 50, 4, 1, .4, .1)])], 11000);
  expect(received.videos[0]).toMatchObject({ interval: 'updating', fps: 20, processingMsPerFrame: 2, droppedFrames: 3, freezes: 1, freezeMs: 400 });
  expect(JSON.stringify(received)).not.toMatch(/private-stream|private-ip|receiver|mediaSourceId|address/);
  expect(screenIntent('auto', 'standard')).toEqual({ hint: 'detail', degradationPreference: 'maintain-resolution' });
  expect(screenIntent('auto', 'ultra')).toEqual({ hint: 'motion', degradationPreference: 'maintain-framerate' });
});

test('screen priority changes on the same capture and sender while the SFU receiver keeps decoding', async ({ page, browser }, info) => {
  test.setTimeout(90_000); await setup(page); await communityOverview(page); const code = await createInvitation(page);
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  try {
    const peer = await other.newPage(); await register(peer, 'Motion receiver'); await peer.goto('/communities'); await peer.getByLabel('Invitation code', { exact: true }).fill(code); await peer.getByRole('button', { name: 'Join community', exact: true }).click(); await joined(peer); await joined(page);
    await priority(page, 'motion'); expect(await page.evaluate(() => window.motionFixture.screen.length)).toBe(0);
    await page.getByLabel('Screen-sharing quality', { exact: true }).selectOption('high'); await expect(page.getByLabel('Screen-sharing quality', { exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Enable camera', exact: true }).click(); await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled();
    await startScreenShare(page); await expect.poll(async () => (await state(page)).preference).toBe('maintain-framerate');
    const original = await state(page); expect(original.hint).toBe('motion'); expect(original.settings).toMatchObject({ width: 1920, height: 1080, frameRate: 30 }); expect(original.encoding).toMatchObject({ maxBitrate: 4_000_000, maxFramerate: 30 }); await expect.poll(() => frames(peer, 'inbound-rtp')).toBeGreaterThan(0);
    const before = await frames(peer, 'inbound-rtp'); await priority(page, 'detail'); await expect.poll(async () => (await state(page)).preference).toBe('maintain-resolution'); const detail = await state(page);
    expect(detail).toMatchObject({ id: original.id, microphone: original.microphone, camera: original.camera, peers: original.peers, hint: 'detail', encoding: original.encoding }); await expect.poll(() => frames(peer, 'inbound-rtp')).toBeGreaterThan(before);
    await priority(page, 'motion'); const after = await frames(peer, 'inbound-rtp'); await expect.poll(() => frames(peer, 'inbound-rtp')).toBeGreaterThan(after); expect((await state(page)).id).toBe(original.id);
    await page.getByText('Connection and media traffic', { exact: true }).click(); await expect(page.getByText('Media counters updating', { exact: true })).toBeVisible(); await expect(page.getByText('Encoding (ms/frame)', { exact: true }).first()).toBeVisible(); await expect(page.getByText(/^Video measurement interval:/).first()).toBeVisible({ timeout: 10_000 });
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save connection report', exact: true }).click(); const file = await download; const stream = (await file.createReadStream())!; let text = ''; for await (const chunk of stream) text += chunk.toString();
    const data = JSON.parse(text) as { version: number; screenContent: string; connection: { videos: { processingMsPerFrame: number | null; captureFps: number | null; fps: number | null }[] } }; expect(data.version).toBe(2); expect(data.screenContent).toBe('motion'); expect(data.connection.videos.some(v => v.processingMsPerFrame !== null && v.processingMsPerFrame > 0 && v.fps !== null && v.fps > 0 && v.captureFps !== null && v.captureFps > 0)).toBe(true); expect(text).not.toMatch(/Motion owner|Motion receiver|candidate|sdp|accessToken|"id"|217\.149/);
    await writeFile(info.outputPath('safe-connection.json'), text);
    await changeLanguage(page, 'ru'); await page.getByRole('button', { name: 'Настройки звука и трансляции', exact: true }).click(); await page.getByLabel('Приоритет демонстрации', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('screen-priority-ru.png'), fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Выйти из голосового канала', exact: true }).click(); expect(await page.evaluate(() => localStorage.getItem('dosvyazi-screen-content'))).toBe('motion');
  } finally { await other.close(); }
});

for (const failure of ['reject', 'ignore'] as const) test(`unconfirmed screen preference (${failure}) retains the source and saved choice`, async ({ page }) => {
  await setup(page); await joined(page); await startScreenShare(page); await expect.poll(async () => (await state(page)).preference).toBe('maintain-resolution'); const original = await state(page);
  await page.evaluate(failure => { window.motionFixture[failure] = true; }, failure); await priority(page, 'motion');
  await expect(page.getByText('Screen motion preference could not be confirmed. The previous choice is kept; your screen remains shared.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Screen content priority', { exact: true })).toHaveValue('auto'); expect(await state(page)).toMatchObject({ id: original.id, preference: original.preference, hint: original.hint, ready: 'live' });
});

test('saved priority survives reload and unsupported initial sender settings are explained without stopping the screen', async ({ page }) => {
  await setup(page); await joined(page); await priority(page, 'motion'); await page.getByRole('button', { name: 'Leave voice', exact: true }).click(); await page.reload(); await joined(page); await audioSettings(page);
  await expect(page.getByLabel('Screen content priority', { exact: true })).toHaveValue('motion'); expect(await page.evaluate(() => window.motionFixture.screen.length)).toBe(0);
  await page.evaluate(() => { window.motionFixture.ignore = true; }); await startScreenShare(page); await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled(); await audioSettings(page);
  await expect(page.getByText('Your browser could not confirm the selected screen priority. The screen is shared; actual motion and detail may differ.', { exact: true })).toBeVisible(); expect((await state(page)).ready).toBe('live');
  await page.evaluate(() => { window.motionFixture.ignore = false; }); await priority(page, 'detail'); await expect.poll(async () => (await state(page)).preference).toBe('maintain-resolution');
});

for (const action of ['stop', 'leave'] as const) test(`late screen parameters cannot restore capture or save preference after ${action}`, async ({ page }) => {
  await setup(page); await joined(page); await startScreenShare(page); await expect.poll(async () => (await state(page)).preference).toBe('maintain-resolution');
  await page.evaluate(() => { window.motionFixture.hold = true; }); await audioSettings(page); await page.getByLabel('Screen content priority', { exact: true }).selectOption('motion'); await expect.poll(() => page.evaluate(() => window.motionFixture.releases.length)).toBe(1);
  await page.getByRole('button', { name: action === 'stop' ? 'Stop sharing' : 'Leave voice', exact: true }).click(); await page.evaluate(() => { const f = window.motionFixture; f.hold = false; f.releases.splice(0).forEach(r => r()); });
  await expect.poll(() => page.evaluate(() => window.motionFixture.screen.every(t => t.readyState === 'ended'))).toBe(true); expect(await page.evaluate(() => localStorage.getItem('dosvyazi-screen-content'))).toBeNull();
  if (action === 'stop') { await audioSettings(page); await expect(page.getByLabel('Screen content priority', { exact: true })).toBeEnabled(); await expect(page.getByLabel('Screen content priority', { exact: true })).toHaveValue('auto'); }
});
