import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createInvitation, audioSettings, changeLanguage, communityOverview, joinVoice } from './workspace-navigation';

declare global { interface Window { enhancedFixture: { raw: MediaStreamTrack[]; outputs: MediaStreamTrack[]; contexts: AudioContext[]; nodes: AudioWorkletNode[]; hold: boolean; holdOffer: boolean; holdModule: boolean; releases: (() => void)[]; fail: boolean; speech: GainNode | undefined } } }
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const f = window.enhancedFixture = { raw: [], outputs: [], contexts: [], nodes: [], hold: false, holdOffer: false, holdModule: false, releases: [], fail: false, speech: undefined } as Window['enhancedFixture'];
    const Audio = AudioContext, Node = AudioWorkletNode;
    window.AudioContext = class extends Audio {
      constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); f.contexts.push(this); }
      createMediaStreamDestination() { const d = super.createMediaStreamDestination(); f.outputs.push(...d.stream.getTracks()); return d; }
    };
    window.AudioWorkletNode = class extends Node { constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) { super(...args); if (args[1].includes('rnnoise')) f.nodes.push(this); } };
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, options) {
      if (f.holdModule) await new Promise<void>(resolve => f.releases.push(resolve)); return addModule.call(this, url, options);
    };
    const offer = RTCPeerConnection.prototype.createOffer as (this: RTCPeerConnection, options?: RTCOfferOptions) => Promise<RTCSessionDescriptionInit>;
    RTCPeerConnection.prototype.createOffer = (async function (this: RTCPeerConnection, options?: RTCOfferOptions) {
      if (f.holdOffer) await new Promise<void>(resolve => f.releases.push(resolve)); return offer.call(this, options);
    }) as typeof RTCPeerConnection.prototype.createOffer;
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints?.audio && f.fail) throw new DOMException('Synthetic denied capture', 'NotAllowedError');
      const stream = await get(constraints); if (!constraints?.audio) return stream;
      stream.getAudioTracks().forEach(t => t.stop());
      // Deterministic synthetic voiced harmonics + stationary noise, not recorded speech.
      const c = new Audio({ sampleRate: 48000 }), d = c.createMediaStreamDestination(), voice = c.createGain(); f.speech = voice;
      const b = c.createBuffer(2, 48000 * 2, 48000); let seed = 1789;
      for (let i = 0; i < b.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; b.getChannelData(0)[i] = (seed / 4294967296 - .5) * .03;
        const t = i / 48000; let v = 0;
        for (let h = 1; h <= 18; h++) v += Math.sin(2 * Math.PI * 120 * h * t) / h;
        b.getChannelData(1)[i] = .13 * v * (.55 + .45 * Math.sin(2 * Math.PI * 3 * t));
      }
      const s = c.createBufferSource(), split = c.createChannelSplitter(2); s.buffer = b; s.loop = true; s.connect(split); split.connect(d, 0); split.connect(voice, 1); voice.connect(d); s.start(); await c.resume();
      const track = d.stream.getAudioTracks()[0]!, stop = track.stop.bind(track); track.stop = () => { stop(); void c.close(); };
      f.raw.push(track); if (f.hold) await new Promise<void>(resolve => f.releases.push(resolve));
      return new MediaStream([track]);
    };
  });
}
async function register(page: Page, name: string) {
  await fixture(page); await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`enhanced-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic enhanced audio 42'); await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function setup(page: Page) {
  await register(page, 'Enhanced owner'); await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Enhanced crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Enhanced crew', exact: true })).toBeVisible();
}
async function joined(page: Page) { await joinVoice(page); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 }); }
async function enhanced(page: Page) { await audioSettings(page); await page.getByRole('checkbox', { name: 'Enhanced noise suppression (RNNoise)', exact: true }).check(); await expect(page.getByRole('checkbox', { name: 'Enhanced noise suppression (RNNoise)', exact: true })).toBeEnabled(); }
const stopped = (page: Page) => page.evaluate(() => [...window.enhancedFixture.raw, ...window.enhancedFixture.outputs].every(t => t.readyState === 'ended'));
async function rms(page: Page, remote = false) {
  return page.evaluate(async remote => {
    const stream = remote ? [...document.querySelectorAll('audio')].map(e => e.srcObject).find(s => s instanceof MediaStream) as MediaStream | undefined : new MediaStream(window.enhancedFixture.outputs.filter(t => t.readyState === 'live'));
    if (!stream?.getAudioTracks().length) return 0;
    const c = new AudioContext(), a = c.createAnalyser(); a.fftSize = 2048; c.createMediaStreamSource(stream).connect(a); await c.resume();
    const data = new Float32Array(2048); let sum = 0;
    for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 50)); a.getFloatTimeDomainData(data); sum += Math.sqrt(data.reduce((v, x) => v + x * x, 0) / data.length); }
    await c.close(); return sum / 12;
  }, remote);
}

test('RNNoise processes real worklet audio, retains a voiced signal, gates mute, persists and releases resources', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); const assets: number[] = [];
  page.on('response', r => { if (/rnnoise.*\.wasm/.test(r.url())) assets.push(r.status()); });
  await setup(page); await joined(page); expect(assets).toEqual([]); await enhanced(page);
  expect(await page.evaluate(() => window.enhancedFixture.raw.length)).toBe(0);
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await audioSettings(page);
  await expect(page.getByText('Enhanced noise processing is active.', { exact: true })).toBeVisible();
  await expect.poll(() => rms(page), { timeout: 15_000 }).toBeGreaterThan(.001);
  const voiced = await rms(page); await page.evaluate(() => { window.enhancedFixture.speech!.gain.value = 0; });
  await expect.poll(() => rms(page), { timeout: 12_000 }).toBeLessThan(.004);
  const noise = await rms(page); expect(noise).toBeLessThan(voiced / 2);
  await writeFile(info.outputPath('synthetic-rms.json'), JSON.stringify({ voicedWithNoise: voiced, noiseOnly: noise, rawNoiseRms: .03 / Math.sqrt(12) }, null, 2));
  await info.attach('synthetic-rms.json', { body: JSON.stringify({ voicedWithNoise: voiced, noiseOnly: noise, rawNoiseRms: .03 / Math.sqrt(12), limitations: 'Synthetic harmonics and stationary noise; not human speech quality or whole-device CPU.' }), contentType: 'application/json' });
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click(); await expect.poll(() => rms(page)).toBeLessThan(.0001);
  await expect.poll(() => page.evaluate(() => window.enhancedFixture.nodes[0]?.context.state)).toBe('suspended');
  await audioSettings(page); await page.getByText('Media devices', { exact: true }).click(); const mic = page.getByLabel('Microphone device', { exact: true });
  await expect(mic).toBeEnabled(); await mic.selectOption({ index: 1 }); await expect.poll(() => stopped(page)).toBe(true);
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await page.evaluate(() => { window.enhancedFixture.speech!.gain.value = 1; });
  await expect.poll(() => rms(page)).toBeGreaterThan(.001);
  await audioSettings(page); await expect(page.getByLabel('Microphone device', { exact: true })).toBeDisabled();
  await changeLanguage(page, 'ru'); await page.getByRole('button', { name: 'Настройки звука и трансляции', exact: true }).click(); await page.getByRole('checkbox', { name: 'Усиленное шумоподавление (RNNoise)', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('enhanced-ru.png'), fullPage: true });
  await page.getByRole('button', { name: 'Выйти из голосового канала', exact: true }).click(); await expect.poll(() => stopped(page)).toBe(true);
  await page.reload(); expect(await page.evaluate(() => localStorage.getItem('dosvyazi-enhanced-noise'))).toBe('true'); expect(assets).toEqual([200, 200]); expect(errors).toEqual([]);
});

for (const action of ['release', 'leave'] as const) test(`enhanced PTT ${action} during publication never opens or retains an ended publication`, async ({ page }) => {
  await setup(page); await joined(page); await enhanced(page); await page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).check(); await expect(page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.evaluate(() => { window.enhancedFixture.holdOffer = true; }); await page.getByRole('button', { name: 'Hold to talk', exact: true }).focus(); await page.keyboard.down('KeyV');
  await expect.poll(() => page.evaluate(() => window.enhancedFixture.releases.length)).toBe(1);
  if (action === 'leave') await page.getByRole('button', { name: 'Leave voice', exact: true }).click(); await page.keyboard.up('KeyV');
  await page.evaluate(() => { const f = window.enhancedFixture; f.holdOffer = false; f.releases.splice(0).forEach(r => r()); }); await expect.poll(() => stopped(page)).toBe(true);
  if (action === 'release') {
    await expect(page.getByRole('button', { name: 'Hold to talk', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Hold to talk', exact: true }).focus(); await page.keyboard.down('KeyV');
    await expect.poll(() => rms(page)).toBeGreaterThan(.001); await page.keyboard.up('KeyV'); await expect.poll(() => rms(page)).toBeLessThan(.0001);
  }
});

test('stalled worklet loading is cancellable before capture and unsupported browsers retain the browser mode', async ({ page }) => {
  await setup(page); await joined(page); await enhanced(page);
  await page.evaluate(() => { window.enhancedFixture.holdModule = true; });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.enhancedFixture.releases.length)).toBe(1);
  await page.getByRole('button', { name: 'Cancel microphone startup', exact: true }).click(); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  await page.evaluate(() => { const f = window.enhancedFixture; f.holdModule = false; f.releases.splice(0).forEach(r => r()); }); await expect.poll(() => stopped(page)).toBe(true); expect(await page.evaluate(() => window.enhancedFixture.raw.length)).toBe(0);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await page.addInitScript(() => { Object.defineProperty(window, 'WebAssembly', { configurable: true, value: undefined }); localStorage.setItem('dosvyazi-enhanced-noise', 'false'); });
  await page.reload(); await joined(page); await audioSettings(page); await expect(page.getByRole('checkbox', { name: 'Enhanced noise suppression (RNNoise)', exact: true })).toBeDisabled();
  await expect(page.getByText('Enhanced processing is unavailable in this browser.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
});

for (const action of ['cancel', 'deafen', 'leave'] as const) test(`enhanced late capture cannot reopen after ${action}`, async ({ page }) => {
  await setup(page); await joined(page); await enhanced(page); await page.evaluate(() => { window.enhancedFixture.hold = true; });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.enhancedFixture.releases.length)).toBe(1);
  await page.getByRole('button', { name: action === 'cancel' ? 'Cancel microphone startup' : action === 'deafen' ? 'Deafen' : 'Leave voice', exact: true }).click();
  await page.evaluate(() => { window.enhancedFixture.releases.splice(0).forEach(r => r()); }); await expect.poll(() => stopped(page)).toBe(true);
  if (action !== 'leave') await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('broken processor assets and capture denial stay muted; explicit retry and processor failure recover safely', async ({ page }, info) => {
  await setup(page); await joined(page); await enhanced(page);
  await page.route('**/*rnnoise*.wasm', route => route.fulfill({ status: 200, body: 'invalid-wasm' }));
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  const error = page.getByText('Enhanced noise processing failed. Your microphone is muted. Enable it to retry or turn enhanced processing off.', { exact: true }).filter({ visible: true });
  await expect(error).toBeVisible(); expect(await page.evaluate(() => window.enhancedFixture.raw.length)).toBe(0); await expect.poll(() => stopped(page)).toBe(true);
  await page.unroute('**/*rnnoise*.wasm'); await page.evaluate(() => { window.enhancedFixture.fail = true; }); await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(page.getByText('Microphone access is blocked. Allow it in your browser and system privacy settings, then try again.', { exact: true }).filter({ visible: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.enhancedFixture.fail = false; }); await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
  await info.attach('processor-before-failure.json', { body: JSON.stringify(await page.evaluate(() => window.enhancedFixture.nodes.map(n => ({ context: n.context.state, handler: typeof n.onprocessorerror })))), contentType: 'application/json' });
  await page.evaluate(() => { const n = window.enhancedFixture.nodes.at(-1)!; n.dispatchEvent(new ErrorEvent('processorerror', { message: 'Synthetic processor failure' })); });
  await expect(page.getByText('Enhanced noise processing stopped. Your microphone is muted. Enable it to retry or turn enhanced processing off.', { exact: true }).filter({ visible: true })).toBeVisible(); await expect.poll(() => stopped(page)).toBe(true);
  await audioSettings(page); await page.getByRole('checkbox', { name: 'Enhanced noise suppression (RNNoise)', exact: true }).uncheck(); await expect(page.getByRole('checkbox', { name: 'Noise suppression', exact: true })).toBeEnabled();
});

test('enhanced audio crosses the SFU while PTT release sends silence and source end stays muted', async ({ page, browser }) => {
  test.setTimeout(90_000); await setup(page); await communityOverview(page); const code = await createInvitation(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] });
  try {
    const peer = await context.newPage(); await register(peer, 'Enhanced receiver'); await peer.goto('/communities'); await peer.getByLabel('Invitation code', { exact: true }).fill(code); await peer.getByRole('button', { name: 'Join community', exact: true }).click(); await joined(peer); await joined(page); await enhanced(page);
    await page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).check(); await expect(page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Hold to talk', exact: true }).focus(); await page.keyboard.down('KeyV'); await expect.poll(() => rms(peer, true), { timeout: 15_000 }).toBeGreaterThan(.001);
    await page.keyboard.up('KeyV'); await expect.poll(() => rms(peer, true)).toBeLessThan(.0001);
    await page.keyboard.down('KeyV'); await expect.poll(() => rms(peer, true)).toBeGreaterThan(.001);
    await page.evaluate(() => { const track = window.enhancedFixture.raw.at(-1)!; track.stop(); track.dispatchEvent(new Event('ended')); }); await page.keyboard.up('KeyV');
    await expect.poll(() => stopped(page)).toBe(true); await expect.poll(() => rms(peer, true)).toBeLessThan(.0001);
  } finally { await context.close(); }
});

test('enhanced PTT retry clears a capture error only after a new explicit hold', async ({ page }) => {
  await setup(page); await joined(page); await enhanced(page); await page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).check(); await expect(page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.evaluate(() => { window.enhancedFixture.fail = true; }); await page.getByRole('button', { name: 'Hold to talk', exact: true }).focus(); await page.keyboard.down('KeyV');
  const error = page.getByText('Microphone access is blocked. Allow it in your browser and system privacy settings, then try again.', { exact: true }).filter({ visible: true });
  await expect(error).toBeVisible(); await page.keyboard.up('KeyV'); await expect.poll(() => stopped(page)).toBe(true);
  await page.evaluate(() => { window.enhancedFixture.fail = false; }); await expect(page.getByRole('button', { name: 'Hold to talk', exact: true })).toBeEnabled(); await page.keyboard.down('KeyV');
  await expect.poll(() => rms(page)).toBeGreaterThan(.001); await expect(error).toHaveCount(0); await page.keyboard.up('KeyV'); await expect.poll(() => rms(page)).toBeLessThan(.0001);
});
