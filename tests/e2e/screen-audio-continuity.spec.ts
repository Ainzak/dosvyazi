import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SignalRequest, TrackSource } from '@livekit/protocol';
import { createInvitation, audioSettings, joinVoice, startScreenShare } from './workspace-navigation';

type Fixture = { options: DisplayMediaStreamOptions | undefined; screen: MediaStreamTrack | undefined; screenContext: AudioContext | undefined; microphone: GainNode | undefined; microphoneTrack: MediaStreamTrack | undefined; peers: RTCPeerConnection[] };
declare global { interface Window { continuityFixture: Fixture } }

// Generated sources replace physical devices and the picker, not encoding, SFU or playback.
async function sources(page: Page) {
  await page.addInitScript(() => {
    const f: Fixture = window.continuityFixture = { options: undefined, screen: undefined, screenContext: undefined, microphone: undefined, microphoneTrack: undefined, peers: [] };
    const NativePeer = RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer { constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) { super(...args); f.peers.push(this); } };
    const audioSource = async (frequency: number) => {
      const context = new AudioContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = frequency; gain.gain.value = .06; oscillator.connect(gain); gain.connect(destination); oscillator.start(); await context.resume();
      const track = destination.stream.getAudioTracks()[0]!, stop = track.stop.bind(track);
      track.stop = () => { stop(); void context.close(); };
      return { track, gain, context };
    };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      if (!options?.audio) return get(options);
      const { track, gain } = await audioSource(220); f.microphone = gain; f.microphoneTrack = track;
      // WebAudio sources have no native microphone processing settings. Model
      // successful preference application so the app does not correctly reject
      // this fixture as a failed microphone refresh. No physical DSP is simulated.
      let constraints = typeof options.audio === 'object' ? { ...options.audio } : {};
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), noiseSuppression: constraints.noiseSuppression !== false,
        echoCancellation: constraints.echoCancellation !== false, autoGainControl: constraints.autoGainControl !== false });
      track.getConstraints = () => ({ ...constraints });
      track.applyConstraints = async next => { constraints = { ...next }; };
      return new MediaStream([track]);
    };
    navigator.mediaDevices.getDisplayMedia = async options => {
      f.options = options;
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d')!; context.fillStyle = '#285c50';
      const stream = canvas.captureStream(15), video = stream.getVideoTracks()[0]!;
      const draw = () => { if (video.readyState === 'ended') return; context.fillRect(0, 0, 640, 360); requestAnimationFrame(draw); }; draw();
      if (options?.audio) { const { track, context: audio } = await audioSource(880); f.screen = track; f.screenContext = audio; stream.addTrack(track); }
      return stream;
    };
  });
}
async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`continuity-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic continuity audio 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}

test('screen audio uses a separate non-speech capture and Opus policy', async ({ page }) => {
  const requests: { source: TrackSource; disableDtx: boolean }[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => {
    if (!Buffer.isBuffer(frame.payload)) return;
    const message = SignalRequest.fromBinary(frame.payload).message;
    if (message.case === 'addTrack') requests.push({ source: message.value.source, disableDtx: message.value.disableDtx });
  }));
  await sources(page); await register(page, 'Capture policy owner'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Capture policy');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await joinVoice(page); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 });
  await startScreenShare(page, true);
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.continuityFixture.options?.audio)).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false });
  expect(await page.evaluate(() => window.continuityFixture.options)).toMatchObject({ windowAudio: 'window', systemAudio: 'exclude', selfBrowserSurface: 'exclude', audio: { restrictOwnAudio: true } });
  const policies = () => page.evaluate(() => {
    const f = window.continuityFixture;
    const result: { screen?: { opus: boolean; dtx: boolean; hint: string }; microphone?: { opus: boolean; dtx: boolean } } = {};
    for (const pc of f.peers) for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender.track?.kind !== 'audio') continue;
      if (![f.screen?.id, f.microphoneTrack?.id].includes(transceiver.sender.track.id)) continue;
      // The SFU answer configures the publisher's Opus encoder. The offer alone
      // does not contain the per-source usedtx preference.
      const section = pc.remoteDescription?.sdp.split(/(?=m=)/).find(part => part.includes(`a=mid:${transceiver.mid}\r\n`));
      if (!section) continue;
      const policy = { opus: section.includes('opus/48000'), dtx: section.includes('usedtx=1') };
      if (transceiver.sender.track.id === f.screen?.id) result.screen = { ...policy, hint: f.screen.contentHint };
      else result.microphone = policy;
    }
    return result;
  });
  await expect.poll(policies).toMatchObject({ screen: { opus: true, dtx: false, hint: 'music' } });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect.poll(() => requests).toEqual(expect.arrayContaining([
    { source: TrackSource.SCREEN_SHARE_AUDIO, disableDtx: true },
    { source: TrackSource.MICROPHONE, disableDtx: false },
  ]));
  // The requested microphone preference is independent; the negotiated answer
  // may coalesce codec parameters across the bundled audio sections.
  await expect.poll(policies).toMatchObject({ screen: { opus: true, dtx: false }, microphone: { opus: true } });
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'Share your screen', exact: true });
  await source.getByLabel('Sound source', { exact: true }).selectOption('system');
  await expect(source.getByText('System audio can send other participants their own voices back. Use headphones and prefer a selected tab or application.')).toBeVisible();
  await source.getByRole('button', { name: 'Choose source', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.continuityFixture.options)).toMatchObject({ windowAudio: 'system', systemAudio: 'include', audio: { restrictOwnAudio: true } });
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
});

// Measures decoded screen energy separately from microphone energy. Counts alone cannot
// detect a live but silent screen track. Warm up the decoder before checking each interval.
async function screenContinuity(page: Page) {
  return page.evaluate(async () => {
    const elements = [...document.querySelectorAll('audio')].filter(e => e.srcObject instanceof MediaStream);
    const c = new AudioContext(), analysers = elements.map(element => {
      const analyser = c.createAnalyser(); analyser.fftSize = 2048;
      c.createMediaStreamSource(element.srcObject as MediaStream).connect(analyser); return analyser;
    }); await c.resume();
    const buffer = new Float32Array(1024);
    const read = (analyser: AnalyserNode) => { analyser.getFloatFrequencyData(buffer); return buffer[Math.round(880 / (c.sampleRate / 2048))]!; };
    await new Promise(resolve => setTimeout(resolve, 300));
    const levels: number[] = [];
    for (let i = 0; i < 20; i++) { levels.push(Math.max(...analysers.map(read))); await new Promise(resolve => setTimeout(resolve, 50)); }
    await c.close(); return { minimumDb: Math.min(...levels), count: elements.length, unmuted: elements.every(e => !e.muted && !e.paused && e.volume > 0) };
  });
}

// Aggregate only; never persist SDP, token, device, candidate or track identifiers.
async function screenTransport(page: Page, sending: boolean, receivedTrack = '') {
  return page.evaluate(async ({ sending, receivedTrack }) => {
    const f = window.continuityFixture, reports: Record<string, number>[] = [];
    for (const pc of f.peers) {
      const endpoints = sending ? pc.getSenders().filter(s => s.track?.id === f.screen?.id) : pc.getReceivers().filter(r => r.track?.id === receivedTrack);
      for (const endpoint of endpoints) for (const stat of (await endpoint.getStats()).values()) {
        if (stat.type !== (sending ? 'outbound-rtp' : 'inbound-rtp') || stat.kind !== 'audio') continue;
        const fields = ['timestamp', 'packetsSent', 'packetsReceived', 'packetsLost', 'bytesSent', 'bytesReceived', 'concealedSamples', 'silentConcealedSamples', 'totalSamplesReceived', 'jitter', 'totalAudioEnergy'];
        reports.push(Object.fromEntries(fields.filter(key => typeof stat[key] === 'number').map(key => [key, stat[key] as number])));
      }
    }
    return { reports, ...(sending ? { sourceLive: f.screen?.readyState === 'live', sourceEnabled: f.screen?.enabled, sourceContext: f.screenContext?.state } : {}) };
  }, { sending, receivedTrack });
}

test('screen sound survives simultaneous microphone speech, mute, processing and PTT changes', async ({ page, browser }, info) => {
  test.setTimeout(120_000); await sources(page); await register(page, 'Continuity sender'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Continuity crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  const code = await createInvitation(page);
  const context = await browser.newContext({ baseURL: process.env.DOSVYAZI_BROWSER_ORIGIN ?? 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] });
  try {
    const receiver = await context.newPage(); await sources(receiver); await register(receiver, 'Continuity receiver'); await receiver.goto('/communities');
    await receiver.getByLabel('Invitation code', { exact: true }).fill(code); await receiver.getByRole('button', { name: 'Join community', exact: true }).click();
    await joinVoice(receiver);
    await expect(receiver.getByRole('region', { name: 'Voice controls', exact: true })).toContainText('Connected · Muted', { timeout: 20_000 });
    await joinVoice(page);
    await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 });
    await startScreenShare(page, true); await expect(receiver.locator('audio')).toHaveCount(1, { timeout: 15_000 });
    const original = await receiver.locator('audio').evaluate(e => ((e as HTMLAudioElement).srcObject as MediaStream).getAudioTracks()[0]!.id);
    const evidence: { phase: string; minimumDb: number; count: number; unmuted: boolean }[] = [];
    const check = async (phase: string) => {
      await expect.poll(async () => (await screenContinuity(receiver)).minimumDb).toBeGreaterThan(-55);
      const before = { sender: await screenTransport(page, true), receiver: await screenTransport(receiver, false, original) };
      const sample = await screenContinuity(receiver);
      const after = { sender: await screenTransport(page, true), receiver: await screenTransport(receiver, false, original) };
      await info.attach('screen-phase-' + phase, { body: JSON.stringify({ phase, sample, before, after }), contentType: 'application/json' });
      expect(sample.minimumDb, phase).toBeGreaterThan(-55); expect(sample.unmuted).toBe(true);
      expect(await receiver.locator('audio').evaluateAll((elements, id) => elements.some(e => ((e as HTMLAudioElement).srcObject as MediaStream).getAudioTracks()[0]?.id === id), original)).toBe(true);
      evidence.push({ phase, ...sample });
    };
    await check('microphone-muted');
    await receiver.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect(page.locator('audio')).toHaveCount(1); await check('viewer-speaking');
    expect(await receiver.evaluate(() => window.continuityFixture.microphoneTrack?.readyState)).toBe('live');
    await receiver.evaluate(() => { window.continuityFixture.microphone!.gain.value = 0; }); await check('viewer-silent');
    await receiver.evaluate(() => { window.continuityFixture.microphone!.gain.value = .06; }); await check('viewer-speaking-again');
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await expect(receiver.locator('audio')).toHaveCount(2);
    await check('microphone-and-screen');
    // Prove the second source is really being decoded, rather than merely published.
    expect(await receiver.evaluate(async () => {
      const c = new AudioContext(), buffer = new Float32Array(2048); let level = -Infinity;
      for (const e of document.querySelectorAll('audio')) {
        const analyser = c.createAnalyser(); analyser.fftSize = 4096; c.createMediaStreamSource(e.srcObject as MediaStream).connect(analyser); await c.resume();
        await new Promise(resolve => setTimeout(resolve, 200)); analyser.getFloatFrequencyData(buffer); level = Math.max(level, buffer[Math.round(220 / (c.sampleRate / 4096))]!);
      }
      await c.close(); return level;
    })).toBeGreaterThan(-55);
    await page.evaluate(() => { window.continuityFixture.microphone!.gain.value = 0; }); await check('microphone-silent');
    await page.evaluate(() => { window.continuityFixture.microphone!.gain.value = .06; }); await check('microphone-speaking-again');
    await page.getByRole('button', { name: 'Mute microphone', exact: true }).click(); await check('microphone-muted-again');
    await audioSettings(page); await page.getByRole('checkbox', { name: 'Noise suppression', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await check('browser-suppression-off');
    await audioSettings(page); await page.getByRole('checkbox', { name: 'Enhanced noise suppression (RNNoise)', exact: true }).check();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await check('enhanced-microphone');
    await audioSettings(page); await page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).check();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    const hold = page.getByRole('button', { name: 'Hold to talk', exact: false });
    // Mode changes await unpublication over signaling; focus() alone can target
    // the disabled button and send the key before the new mode is ready.
    await expect(hold).toBeEnabled(); await hold.focus();
    await page.keyboard.down('KeyV'); await expect(hold).toHaveAttribute('aria-pressed', 'true'); await check('ptt-held');
    await page.keyboard.up('KeyV'); await check('ptt-released');
    await audioSettings(receiver); await receiver.getByRole('checkbox', { name: 'Enhanced noise suppression (RNNoise)', exact: true }).check();
    await receiver.getByRole('button', { name: 'Close settings', exact: true }).click();
    await receiver.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await check('viewer-enhanced-microphone');
    await receiver.getByRole('button', { name: 'Mute microphone', exact: true }).click(); await check('viewer-muted-again');
    await info.attach('decoded-screen-continuity', { body: JSON.stringify({ synthetic: true, evidence }, null, 2), contentType: 'application/json' });
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
    await receiver.getByRole('button', { name: 'Leave voice', exact: true }).click();
  } finally { await context.close(); }
});
