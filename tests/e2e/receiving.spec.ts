import { expect, test } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { ConnectionCounter } from '../../apps/web/src/features/voice/connectionStats';
import { audioSettings, communityOverview, joinVoice, changeLanguage } from './workspace-navigation';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream=device-count=4,fps=30', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
declare global { interface Window { receivingFixture: { pcs: RTCPeerConnection[]; failStats: boolean; holdStats: boolean; releases: (() => void)[]; tracks: MediaStreamTrack[] } } }
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const f = window.receivingFixture = { pcs: [], failStats: false, holdStats: false, releases: [], tracks: [] } as Window['receivingFixture'];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await capture(options); f.tracks.push(...stream.getTracks()); return stream; };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const stream = await capture({ audio: false, video: { deviceId: { exact: devices.at(-1)!.deviceId }, width: 1280, height: 720, frameRate: 15 } });
      f.tracks.push(...stream.getTracks()); return stream;
    };
    const get = RTCRtpReceiver.prototype.getStats;
    RTCRtpReceiver.prototype.getStats = async function () {
      if (f.failStats) throw new Error('Synthetic stats failure');
      if (f.holdStats) await new Promise<void>(resolve => f.releases.push(resolve));
      return get.call(this);
    };
    const Native = RTCPeerConnection;
    window.RTCPeerConnection = class extends Native { constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) { super(...args); f.pcs.push(this); } };
  });
}
async function register(page: Page, name: string) {
  await fixture(page); await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`receiving-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic receiving controls 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
// A transient control-service failure follows the client's existing ten-second
// automatic retry path; match the established media suite's connection budget.
async function joined(page: Page) { await joinVoice(page); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 }); }
const policy = (page: Page) => page.getByLabel('Incoming video', { exact: true });
const camera = (page: Page) => page.getByRole('checkbox', { name: 'Receive Media sender: Camera', exact: true });
const screen = (page: Page) => page.getByRole('checkbox', { name: 'Receive Media sender: Screen share', exact: true });
async function point(page: Page) {
  return page.evaluate(async () => {
    const reports = await Promise.all(window.receivingFixture.pcs.map(pc => pc.getStats()));
    return reports.flatMap(report => Array.from(report.values()).filter(r => r.type === 'inbound-rtp').map(r => ({ id: r.id as string, kind: (r.kind ?? r.mediaType) as string, bytes: (r.bytesReceived ?? 0) as number, frames: (r.framesDecoded ?? 0) as number })));
  });
}

test('RTP counters deduplicate reports, handle reset and gaps and never export raw stats', () => {
  const report = (rows: Record<string, unknown>[]) => new Map(rows.map(row => [row.id, row])) as unknown as RTCStatsReport;
  const first = report([{ id: 'v', type: 'inbound-rtp', kind: 'video', framesDecoded: 0, bytesReceived: 1000, packetsReceived: 10, packetsLost: 1, jitter: .02, address: 'private-address' }, { id: 'a', type: 'outbound-rtp', bytesSent: 500 }]);
  const counter = new ConnectionCounter(0); const a = counter.sample([first, first], 1000);
  expect(a.receivedBytes).toBe(1000); expect(a.sentBytes).toBe(500); expect(a.receiveBps).toBeNull(); expect(a.jitterMs).toBe(20);
  const b = counter.sample([report([{ id: 'v', type: 'inbound-rtp', kind: 'video', frameWidth: 640, frameHeight: 360, framesDecoded: 10, bytesReceived: 1500, packetsReceived: 20, packetsLost: 2 }])], 3000);
  expect(b.receiveBps).toBe(2000); expect(b.lossPercent).toBeCloseTo(100 / 11);
  expect(b.videos).toEqual([{ direction: 'receiving', width: 640, height: 360, fps: 5 }]);
  const gap = counter.sample([], 5000); expect(gap.receiveBps).toBe(0);
  const reset = counter.sample([report([{ id: 'v', type: 'inbound-rtp', bytesReceived: 100 }])], 7000);
  expect(reset.receivedBytes).toBe(1600); expect(reset.receiveBps).toBe(400);
  expect(JSON.stringify(reset)).not.toMatch(/private-address|"id"|bytesReceived/);
  const missing = counter.sample([report([{ id: 'v', type: 'inbound-rtp', kind: 'video', bytesReceived: 200 }])], 9000);
  expect(missing.videos[0]!.fps).toBeNull();
  const unsupported = counter.sample([report([{ id: 'v', type: 'inbound-rtp', kind: 'video' }])], 11000);
  expect(unsupported.status).toBe('waiting'); expect(unsupported.receivedBytes).toBe(1700); expect(unsupported.lossPercent).toBeNull();
});

test('selective receiving stops RTP, preserves voice and publishers, and exports private aggregate evidence', async ({ page, browser, context }, info) => {
  test.setTimeout(180_000); await context.grantPermissions(['microphone', 'camera']);
  await register(page, 'Media sender'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Receiving crew'); await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const invitation = await page.getByLabel('Share this invitation code').inputValue();
  const peerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  try {
    const peer = await peerContext.newPage(); await register(peer, 'Media receiver'); await peer.goto('/communities');
    await peer.getByLabel('Invitation code', { exact: true }).fill(invitation); await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await joined(peer); await audioSettings(peer); await policy(peer).selectOption('none');
    await joined(page);
    for (const name of ['Enable microphone', 'Enable camera', 'Share screen']) { await page.getByRole('button', { name, exact: true }).click(); }
    await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
    const ids = await page.evaluate(() => window.receivingFixture.tracks.map(t => t.id));
    let joins = 0; peer.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/voice/join')) joins++; });
    await peer.getByRole('button', { name: 'Close settings', exact: true }).click();
    await peer.getByRole('button', { name: 'View shared video (2)', exact: true }).click();
    await expect(camera(peer)).not.toBeChecked(); await expect(screen(peer)).not.toBeChecked(); await expect(camera(peer)).toBeDisabled();
    await expect(peer.getByLabel('Media sender: Screen share', { exact: true })).toHaveCount(0);
    await audioSettings(peer); await policy(peer).selectOption('screen');
    await expect(camera(peer)).toBeDisabled(); await expect(screen(peer)).toBeChecked();
    await expect.poll(() => peer.getByLabel('Media sender: Screen share', { exact: true }).evaluate(e => (e as HTMLVideoElement).videoWidth)).toBe(1280);
    await screen(peer).uncheck(); await expect(peer.getByLabel('Media sender: Screen share', { exact: true })).toHaveCount(0);
    await audioSettings(page); await page.getByLabel('Screen-sharing quality', { exact: true }).selectOption('high');
    await expect(page.getByLabel('Screen-sharing quality', { exact: true })).toBeEnabled();
    await expect(screen(peer)).not.toBeChecked();
    await expect(peer.getByLabel('Media sender: Screen share', { exact: true })).toHaveCount(0);
    await page.getByLabel('Screen-sharing quality', { exact: true }).selectOption('standard');
    await expect(page.getByLabel('Screen-sharing quality', { exact: true })).toBeEnabled();
    await screen(peer).check();
    await expect.poll(() => peer.getByLabel('Media sender: Screen share', { exact: true }).evaluate(e => (e as HTMLVideoElement).videoWidth)).toBe(1280);
    await policy(peer).selectOption('all'); await expect(camera(peer)).toBeChecked();
    await expect.poll(() => peer.getByLabel('Media sender: Camera', { exact: true }).evaluate(e => (e as HTMLVideoElement).videoWidth)).toBe(640);
    const cdp = await peerContext.newCDPSession(peer); await cdp.send('Performance.enable');
    const metrics = async () => (await cdp.send('Performance.getMetrics')).metrics;
    const windows = [];
    for (const mode of ['all', 'none', 'none', 'all'] as const) {
      await policy(peer).selectOption(mode);
      if (mode === 'all') await expect(peer.getByLabel('Media sender: Camera', { exact: true })).toBeVisible();
      // Settle subscription negotiation before the fixed measured window.
      await peer.waitForTimeout(1500); await peer.bringToFront();
      const before = await point(peer); const resourcesBefore = await metrics(); const started = performance.now();
      await peer.waitForTimeout(6000);
      const after = await point(peer); const resourcesAfter = await metrics();
      const seconds = (performance.now() - started) / 1000;
      const delta = (kind: string, field: 'bytes' | 'frames') => after.filter(r => r.kind === kind).reduce((sum, row) => sum + Math.max(0, row[field] - (before.find(old => old.id === row.id)?.[field] ?? 0)), 0);
      const videoBytes = delta('video', 'bytes'), audioBytes = delta('audio', 'bytes');
      const metric = (rows: typeof resourcesBefore, name: string) => rows.find(r => r.name === name)?.value ?? null;
      const taskBefore = metric(resourcesBefore, 'TaskDuration'), taskAfter = metric(resourcesAfter, 'TaskDuration');
      windows.push({ mode, seconds, videoBytes, audioBytes, decodedFrames: delta('video', 'frames'), videoBps: videoBytes * 8 / seconds,
        rendererMainThreadTaskSeconds: taskAfter !== null && taskBefore !== null ? taskAfter - taskBefore : null,
        jsHeapUsedBytes: metric(resourcesAfter, 'JSHeapUsedSize') });
      if (mode === 'none') expect(videoBytes).toBe(0); else { expect(videoBytes).toBeGreaterThan(1000); expect(delta('video', 'frames')).toBeGreaterThan(0); }
      expect(audioBytes).toBeGreaterThan(0);
    }
    const result = { protocol: 'Same synthetic sender, standard camera/screen, all-none-none-all, 1.5s settle +6s per window; local real SFU', project: info.project.name, browser: browser.version(), viewport: page.viewportSize(), windows,
      limitations: ['RTP payload only', 'Renderer main-thread task duration and JavaScript heap are not whole-device CPU/RAM', 'Shared local synthetic clients; not remote-network or competitor evidence', 'Short functional comparison; no capacity or quality superiority claim'] };
    await writeFile(info.outputPath('receiving-comparison.json'), JSON.stringify(result, null, 2));
    expect(await page.evaluate(() => window.receivingFixture.tracks.map(t => t.id))).toEqual(ids);
    expect(await page.evaluate(() => window.receivingFixture.tracks.every(t => t.readyState === 'live'))).toBe(true); expect(joins).toBe(0);
    await peer.getByText('Connection and media traffic', { exact: true }).click();
    await expect(peer.getByText('Media counters updating', { exact: true })).toBeVisible();
    await expect(peer.getByText(/Incoming video stream .*1280 × 720/)).toBeVisible();
    await peer.screenshot({ path: info.outputPath('receiving-selection-en.png'), fullPage: true });
    const downloadPromise = peer.waitForEvent('download'); await peer.getByRole('button', { name: 'Save connection report', exact: true }).click();
    const download = await downloadPromise; const report = JSON.parse(await readFile((await download.path())!, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(report).sort()).toEqual(['connection', 'excludes', 'quality', 'receiving', 'reset', 'scope', 'version']);
    expect(JSON.stringify(report)).not.toMatch(/Media sender|Media receiver|Receiving crew|example.test|127\.0\.0\.1|token":|candidate|trackSid/);
    await peer.evaluate(() => { window.receivingFixture.failStats = true; });
    await expect(peer.getByText('Media counters unavailable', { exact: true })).toBeVisible({ timeout: 8000 });
    await peer.evaluate(() => { window.receivingFixture.failStats = false; });
    await expect(peer.getByText('Media counters updating', { exact: true })).toBeVisible({ timeout: 8000 });
    await peer.evaluate(() => { window.receivingFixture.holdStats = true; });
    await expect.poll(() => peer.evaluate(() => window.receivingFixture.releases.length)).toBeGreaterThan(0);
    await expect(peer.getByText('Media counters unavailable', { exact: true })).toBeVisible({ timeout: 14000 });
    await policy(peer).selectOption('none'); await peer.getByRole('button', { name: 'Leave voice', exact: true }).click();
    await peer.evaluate(() => { window.receivingFixture.holdStats = false; window.receivingFixture.releases.splice(0).forEach(release => release()); });
    await expect(peer.getByLabel('Incoming video', { exact: true })).toHaveCount(0);
    await peer.reload(); await joined(peer); await audioSettings(peer); await expect(policy(peer)).toHaveValue('none');
    await changeLanguage(peer, 'ru'); await peer.getByText('Связь и медиатрафик', { exact: true }).click();
    await peer.getByLabel('Принимать видео', { exact: true }).scrollIntoViewIfNeeded();
    expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await peer.screenshot({ path: info.outputPath('receiving-ru.png'), fullPage: true });
    await peer.getByRole('button', { name: 'Выйти из голосового канала', exact: true }).click();
    await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  } finally { await peerContext.close(); }
});
