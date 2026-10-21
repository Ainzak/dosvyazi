import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { audioSettings, changeLanguage, communityOverview, joinVoice } from './workspace-navigation';

// Chromium's second default fake device uses Y16 depth frames. Device0 and3
// use I420, so use those two independent color sources for camera and screen.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream=device-count=4,fps=60', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });

declare global {
  interface Window {
    qualityFixture: { mic: MediaStreamTrack[]; camera: MediaStreamTrack[]; screen: MediaStreamTrack[]; pcs: RTCPeerConnection[];
      failConstraints: number; failPublish: number; hold: boolean; holdOffer: boolean; release?: () => void };
  }
}

async function fixture(page: Page) {
  await page.addInitScript(() => {
    const f = window.qualityFixture = { mic: [], camera: [], screen: [], pcs: [], failConstraints: 0, failPublish: 0, hold: false, holdOffer: false } as Window['qualityFixture'];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await capture(options);
      if (options?.audio) f.mic.push(...stream.getAudioTracks());
      if (options?.video) f.camera.push(...stream.getVideoTracks());
      return stream;
    };
    // Replace only the human source picker; Chromium still captures, constrains,
    // encodes and sends a synthetic high-resolution source through the real SFU.
    navigator.mediaDevices.getDisplayMedia = async () => {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      const stream = await capture({ audio: false, video: { deviceId: { exact: devices.at(-1)!.deviceId }, width: 2560, height: 1440, frameRate: 60 } });
      f.screen.push(...stream.getVideoTracks()); return stream;
    };
    const apply = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = async function (constraints) {
      if (this.kind === 'video') {
        if (f.hold) await new Promise<void>(resolve => { f.release = resolve; });
        if (f.failConstraints > 0) { f.failConstraints--; throw new DOMException('Synthetic constraint failure', 'OverconstrainedError'); }
      }
      return apply.call(this, constraints);
    };
    const add = RTCPeerConnection.prototype.addTransceiver;
    RTCPeerConnection.prototype.addTransceiver = function (track, options) {
      if (f.failPublish > 0) { f.failPublish--; throw new Error('Synthetic publication failure'); }
      return add.call(this, track, options);
    };
    // LiveKit uses the promise overload, not the legacy callback signature.
    const offer = RTCPeerConnection.prototype.createOffer as (this: RTCPeerConnection, options?: RTCOfferOptions) => Promise<RTCSessionDescriptionInit>;
    RTCPeerConnection.prototype.createOffer = (async function (this: RTCPeerConnection, options?: RTCOfferOptions) {
      if (f.holdOffer) await new Promise<void>(resolve => { f.release = resolve; });
      return offer.call(this, options);
    }) as typeof RTCPeerConnection.prototype.createOffer;
    const Native = RTCPeerConnection;
    window.RTCPeerConnection = class extends Native { constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) { super(...args); f.pcs.push(this); } };
  });
}
async function register(page: Page, name: string) {
  await fixture(page); await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`quality-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic quality controls 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function setup(page: Page) {
  await register(page, 'Quality owner'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Quality crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quality crew', exact: true })).toBeVisible();
}
async function join(page: Page) {
  await joinVoice(page); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 });
  await audioSettings(page);
}
const audio = (p: Page) => p.getByRole('checkbox', { name: 'Reduce audio quality', exact: true });
const camera = (p: Page) => p.getByRole('checkbox', { name: 'Reduce camera quality', exact: true });
const screen = (p: Page) => p.getByLabel('Screen-sharing quality', { exact: true });
async function select(page: Page, a: boolean, c: boolean, s: string) {
  if (await audio(page).isChecked() !== a) await audio(page).click();
  await expect(audio(page)).toHaveJSProperty('checked', a); await expect(audio(page)).toBeEnabled();
  if (await camera(page).isChecked() !== c) await camera(page).click();
  await expect(camera(page)).toHaveJSProperty('checked', c); await expect(camera(page)).toBeEnabled();
  await screen(page).selectOption(s); await expect(screen(page)).toBeEnabled();
}
const sources = (page: Page) => page.evaluate(() => {
  const f = window.qualityFixture;
  return Object.fromEntries((['mic', 'camera', 'screen'] as const).map(source => {
    const track = f[source].at(-1);
    const tx = f.pcs.flatMap(pc => pc.getTransceivers()).find(t => ['sendonly', 'sendrecv'].includes(t.direction) && t.sender.track === track);
    return [source, { id: track?.id, state: track?.readyState, enabled: track?.enabled, settings: track?.getSettings(), contentHint: track?.contentHint, encoding: tx?.sender.getParameters().encodings?.[0] }];
  }));
});

test('independent quality preferences cover all combinations without starting inactive sources and persist in Russian', async ({ page }, info) => {
  await setup(page); await join(page);
  for (const a of [false, true]) for (const c of [false, true]) for (const s of ['economy', 'standard', 'high', 'ultra']) {
    await select(page, a, c, s);
    await expect.poll(() => page.evaluate(() => [localStorage.getItem('dosvyazi-quality-audio') ?? 'standard', localStorage.getItem('dosvyazi-quality-camera') ?? 'standard', localStorage.getItem('dosvyazi-quality-screen')])).toEqual([a ? 'economy' : 'standard', c ? 'economy' : 'standard', s]);
  }
  expect(await page.evaluate(() => [window.qualityFixture.mic.length, window.qualityFixture.camera.length, window.qualityFixture.screen.length])).toEqual([0, 0, 0]);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await page.reload(); await join(page); await expect(audio(page)).toBeChecked(); await expect(camera(page)).toBeChecked(); await expect(screen(page)).toHaveValue('ultra');
  await changeLanguage(page, 'ru');
  await expect(page.getByRole('checkbox', { name: 'Снизить качество звука', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Снизить качество камеры', exact: true })).toBeChecked();
  await page.getByLabel('Качество демонстрации экрана', { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('quality-settings-ru.png'), fullPage: true });
  await page.getByRole('button', { name: 'Выйти из голосового канала', exact: true }).click();
});

test('live sixteen-profile matrix changes only its source and high screen sends more detail to a peer', async ({ page, browser, context }, info) => {
  test.setTimeout(180_000); await context.grantPermissions(['microphone', 'camera']);
  await setup(page); await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const peerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const peer = await peerContext.newPage(); await register(peer, 'Quality receiver'); await peer.goto('/communities');
    await peer.getByLabel('Invitation code', { exact: true }).fill(code); await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await join(page); await join(peer);
    let joins = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/voice/join')) joins++; });
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
    await peer.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect(peer.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
    const peerMic = (await sources(peer)).mic!.id;
    await peer.getByRole('button', { name: 'Close settings', exact: true }).click();
    await peer.getByRole('button', { name: 'View shared video (2)', exact: true }).click();
    await peer.bringToFront();
    const initialScreen = peer.getByLabel('Quality owner: Screen share', { exact: true });
    await initialScreen.scrollIntoViewIfNeeded();
    await expect.poll(() => initialScreen.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    const before = await sources(page); const evidence = [];
    for (const a of [false, true]) for (const c of [false, true]) for (const s of ['economy', 'standard', 'high', 'ultra']) {
      await select(page, a, c, s);
      await expect(page.getByText('Quality could not be changed. The previous setting is kept. Try again.', { exact: true })).toHaveCount(0);
      const observed = await sources(page); evidence.push({ audio: a, camera: c, screen: s, observed });
      for (const source of ['mic', 'camera', 'screen']) { expect(observed[source]!.id).toBe(before[source]!.id); expect(observed[source]!.state).toBe('live'); }
      expect(observed.mic!.encoding!.maxBitrate).toBe(a ? 24_000 : 48_000);
      expect(observed.camera!.encoding!.maxBitrate).toBe(c ? 150_000 : 450_000);
      expect(observed.camera!.settings!.width).toBe(c ? 320 : 640);
      expect(observed.screen!.encoding!.maxBitrate).toBe(s === 'ultra' ? 12_000_000 : s === 'high' ? 4_000_000 : s === 'economy' ? 450_000 : 1_200_000);
      expect(observed.screen!.settings!.width).toBe(s === 'ultra' ? 2560 : s === 'high' ? 1920 : s === 'economy' ? 854 : 1280);
      expect(observed.screen!.encoding!.maxFramerate).toBe(s === 'ultra' ? 60 : s === 'high' ? 30 : s === 'economy' ? 10 : 15);
      expect(observed.screen!.settings!.frameRate).toBe(s === 'ultra' ? 60 : s === 'high' ? 30 : s === 'economy' ? 10 : 15);
      expect(observed.screen!.contentHint).toBe(s === 'ultra' ? 'motion' : 'detail');
      expect((await sources(peer)).mic!.id).toBe(peerMic);
      await expect(peer.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
    }
    const matrixPath = info.outputPath('profile-matrix.json');
    await writeFile(matrixPath, JSON.stringify(evidence, null, 2));
    await info.attach('profile-matrix.json', { path: matrixPath, contentType: 'application/json' });
    const video = peer.getByLabel('Quality owner: Screen share', { exact: true });
    await peer.bringToFront();
    await video.scrollIntoViewIfNeeded();
    await info.attach('peer-debug.json', { body: JSON.stringify(await peer.evaluate(async () => ({ visibility: document.visibilityState, videos: Array.from(document.querySelectorAll('video')).map(v => ({width:v.videoWidth, ready:v.readyState, paused:v.paused})), stats: (await Promise.all(window.qualityFixture.pcs.map(pc => pc.getStats()))).flatMap(report => Array.from(report.values()).filter(row => ['inbound-rtp','outbound-rtp'].includes(row.type))) })), null, 2), contentType: 'application/json' });
    await expect.poll(() => video.evaluate(element => [(element as HTMLVideoElement).videoWidth, (element as HTMLVideoElement).videoHeight]), { timeout: 20_000 }).toEqual([2560, 1440]);
    expect(joins).toBe(0);
    expect(await page.evaluate(() => [window.qualityFixture.mic.length, window.qualityFixture.camera.length, window.qualityFixture.screen.length])).toEqual([1, 1, 1]);
    await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
    expect(await page.evaluate(() => [...window.qualityFixture.mic, ...window.qualityFixture.camera, ...window.qualityFixture.screen].every(track => track.readyState === 'ended'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await peerContext.close(); }
});

test('1440p60 starts from a saved preference and a rejected screen change restores its motion hint', async ({ page, context }) => {
  test.setTimeout(60_000); await context.grantPermissions(['microphone', 'camera']);
  await setup(page); await join(page); await screen(page).selectOption('ultra');
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await page.reload(); await join(page);
  await expect(screen(page)).toHaveValue('ultra');
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
  const before = (await sources(page)).screen!;
  expect(before.settings).toMatchObject({ width: 2560, height: 1440, frameRate: 60 });
  expect(before.encoding).toMatchObject({ maxBitrate: 12_000_000, maxFramerate: 60 });
  expect(before.contentHint).toBe('motion');
  await page.evaluate(() => { window.qualityFixture.failConstraints = 1; });
  await screen(page).selectOption('high');
  await expect(page.getByText('Quality could not be changed. The previous setting is kept. Try again.', { exact: true })).toBeVisible();
  await expect(screen(page)).toHaveValue('ultra');
  const after = (await sources(page)).screen!;
  expect(after.id).toBe(before.id); expect(after.state).toBe('live');
  expect(after.contentHint).toBe('motion'); expect(after.settings).toEqual(before.settings);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
});

test('constraint rollback and explicit publication recovery preserve the unrelated screen', async ({ page, context }) => {
  test.setTimeout(60_000); await context.grantPermissions(['microphone', 'camera']); await setup(page); await join(page);
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
  const before = await sources(page);
  await page.evaluate(() => { window.qualityFixture.failConstraints = 1; }); await camera(page).click();
  await expect(page.getByText('Quality could not be changed. The previous setting is kept. Try again.', { exact: true })).toBeVisible();
  await expect(camera(page)).not.toBeChecked(); await expect(camera(page)).toBeEnabled();
  expect((await sources(page)).camera!.encoding!.maxBitrate).toBe(450_000);
  await page.evaluate(() => { window.qualityFixture.failPublish = 1; }); await camera(page).click();
  await expect(page.getByText('Quality could not be restored. Enable the affected source to try again.', { exact: true })).toBeVisible();
  await expect(camera(page)).not.toBeChecked(); await expect(camera(page)).toBeEnabled();
  expect((await sources(page)).camera!.state).toBe('ended');
  expect((await sources(page)).screen!.id).toBe(before.screen!.id); expect((await sources(page)).screen!.state).toBe('live');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled();
  await camera(page).click(); await expect(camera(page)).toBeChecked(); await expect(camera(page)).toBeEnabled();
  expect((await sources(page)).camera!.encoding!.maxBitrate).toBe(150_000);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
});

test('leaving while a quality change is pending stops capture and discards the late result', async ({ page, context }) => {
  await context.grantPermissions(['microphone', 'camera']); await setup(page); await join(page);
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.qualityFixture.hold = true; });
  await screen(page).selectOption('ultra');
  await expect(page.getByText('Applying media quality…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls', exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.qualityFixture.hold = false; window.qualityFixture.release!(); });
  await expect.poll(() => page.evaluate(() => window.qualityFixture.screen.every(track => track.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('dosvyazi-quality-screen'))).toBeNull();
});

for (const action of ['mute', 'deafen'] as const) test(`${action} stays immediate during an in-flight microphone quality change`, async ({ page }) => {
  await setup(page); await join(page);
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(audio(page)).toBeEnabled();
  await page.evaluate(() => { window.qualityFixture.holdOffer = true; });
  await audio(page).click();
  await expect.poll(() => page.evaluate(() => !!window.qualityFixture.release)).toBe(true);
  await page.getByRole('button', { name: action === 'mute' ? 'Mute microphone' : 'Deafen', exact: true }).click();
  expect(await page.evaluate(() => window.qualityFixture.mic.at(-1)!.enabled)).toBe(false);
  await page.evaluate(() => { window.qualityFixture.holdOffer = false; window.qualityFixture.release!(); });
  await expect(audio(page)).toBeEnabled(); await expect(audio(page)).toBeChecked();
  expect(await page.evaluate(() => window.qualityFixture.mic.at(-1)!.enabled)).toBe(false);
  expect(await page.evaluate(() => window.qualityFixture.mic.length)).toBe(1);
  await expect(page.getByRole('region', { name: 'Voice controls', exact: true })).toContainText(action === 'mute' ? 'Connected · Muted' : 'Deafened');
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
});
