import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { audioSettings, communityOverview, joinVoice, workspaceLink, changeLanguage } from './workspace-navigation';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
declare global { interface Window { usabilityFixture: { raw: MediaStreamTrack[]; outputs: MediaStreamTrack[]; gains: GainNode[]; holdCapture: boolean; holdOffer: boolean; fail: string; releases: (() => void)[]; pcs: RTCPeerConnection[] } } }
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const f = window.usabilityFixture = { raw: [], outputs: [], gains: [], holdCapture: false, holdOffer: false, fail: '', releases: [], pcs: [] } as Window['usabilityFixture'];
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      if (f.fail && options?.audio) { const name = f.fail; f.fail = ''; throw new DOMException('Synthetic failure', name); }
      let stream = await get(options);
      if (options?.audio) {
        // A continuous permitted test tone avoids Chromium fake-mic silent periods.
        // Real Web Audio capture, gate, SDK, encoder/SFU and remote decoding remain.
        stream.getAudioTracks().forEach(track => track.stop());
        const context = new Audio(), oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
        oscillator.frequency.value = 440; gain.gain.value = .1; oscillator.connect(gain); gain.connect(destination); oscillator.start(); await context.resume();
        const track = destination.stream.getAudioTracks()[0]!, stop = track.stop.bind(track); let stopped = false;
        track.stop = () => { if (stopped) return; stopped = true; stop(); oscillator.stop(); void context.close(); };
        stream = new MediaStream([track, ...stream.getVideoTracks()]);
      }
      f.raw.push(...stream.getTracks());
      if (options?.audio && f.holdCapture) await new Promise<void>(resolve => f.releases.push(resolve));
      return stream;
    };
    const Audio = window.AudioContext;
    window.AudioContext = class extends Audio {
      createGain() { const gain = super.createGain(); f.gains.push(gain); return gain; }
      createMediaStreamDestination() { const destination = super.createMediaStreamDestination(); f.outputs.push(...destination.stream.getTracks()); return destination; }
    };
    const offer = RTCPeerConnection.prototype.createOffer as (this: RTCPeerConnection, options?: RTCOfferOptions) => Promise<RTCSessionDescriptionInit>;
    RTCPeerConnection.prototype.createOffer = (async function (this: RTCPeerConnection, options?: RTCOfferOptions) { if (f.holdOffer) await new Promise<void>(resolve => f.releases.push(resolve)); return offer.call(this, options); }) as typeof RTCPeerConnection.prototype.createOffer;
    const Native = RTCPeerConnection;
    window.RTCPeerConnection = class extends Native { constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) { super(...args); f.pcs.push(this); } };
  });
}
async function register(page: Page, name = 'Usability owner') {
  await fixture(page); await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`usability-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic usability controls 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function setup(page: Page, name = 'Usability owner') {
  await register(page, name); await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Usability crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Usability crew', exact: true })).toBeVisible();
}
async function joined(page: Page) { await joinVoice(page); await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled({ timeout: 20_000 }); }
async function ptt(page: Page) { await joined(page); await audioSettings(page); await page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).check(); await expect(page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Close settings', exact: true }).click(); }
const hold = (page: Page) => page.getByRole('button', { name: 'Hold to talk', exact: true });
const allStopped = (page: Page) => page.evaluate(() => [...window.usabilityFixture.raw, ...window.usabilityFixture.outputs].every(t => t.readyState === 'ended'));
const gateValue = (page: Page) => page.evaluate(() => window.usabilityFixture.gains.at(-1)?.gain.value ?? 0);
async function receivedSignal(page: Page) {
  return page.evaluate(async () => {
    const audio = [...document.querySelectorAll('audio')].find(element => element.srcObject instanceof MediaStream);
    if (!audio) return 0;
    const context = new AudioContext(), analyser = context.createAnalyser(); analyser.fftSize = 512;
    context.createMediaStreamSource(audio.srcObject as MediaStream).connect(analyser); await context.resume();
    const values = new Float32Array(512); let peak = 0;
    for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 50)); analyser.getFloatTimeDomainData(values); peak = Math.max(peak, Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)); }
    await context.close(); return peak;
  });
}
async function releaseFixtures(page: Page) { await page.evaluate(() => { const f = window.usabilityFixture; f.holdCapture = false; f.holdOffer = false; f.releases.splice(0).forEach(release => release()); }); }

test('pre-call check is explicit, local, audible only by choice and ends when joining', async ({ page }, info) => {
  await setup(page); let joins = 0; page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/voice/join')) joins++; });
  expect(await page.evaluate(() => window.usabilityFixture.raw.length)).toBe(0);
  await page.getByText('Check microphone before joining', { exact: true }).click();
  await page.getByRole('button', { name: 'Start microphone check', exact: true }).click();
  await expect(page.getByText('Microphone check is running locally.', { exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole('meter', { name: 'Microphone signal', exact: true }).evaluate(e => (e as HTMLMeterElement).value)).toBeGreaterThan(0);
  expect(await page.locator('audio').evaluateAll(items => items.every(e => (e as HTMLAudioElement).paused))).toBe(true);
  await page.getByRole('button', { name: 'Listen locally', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluateAll(items => items.some(e => !(e as HTMLAudioElement).paused))).toBe(true);
  await page.getByRole('button', { name: 'Stop local listening', exact: true }).click();
  expect(joins).toBe(0); await changeLanguage(page, 'ru');
  await page.screenshot({ path: info.outputPath('microphone-check-ru.png'), fullPage: true });
  await changeLanguage(page, 'en'); await joined(page); await expect.poll(() => allStopped(page)).toBe(true);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
});

for (const action of ['stop', 'navigation'] as const) test(`late local microphone capture is discarded after ${action}`, async ({ page }) => {
  await setup(page); await page.getByText('Check microphone before joining', { exact: true }).click();
  await page.evaluate(() => { window.usabilityFixture.holdCapture = true; });
  await page.getByRole('button', { name: 'Start microphone check', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.usabilityFixture.releases.length)).toBeGreaterThan(0);
  if (action === 'stop') await page.getByRole('button', { name: 'Stop microphone check', exact: true }).click(); else await workspaceLink(page, 'Messages');
  await releaseFixtures(page); await expect.poll(() => allStopped(page)).toBe(true);
  await expect(page.getByRole('button', { name: 'Listen locally', exact: true })).toHaveCount(0);
});

test('microphone denial and ended input are recoverable without joining voice', async ({ page }) => {
  await setup(page); await page.getByText('Check microphone before joining', { exact: true }).click();
  await page.evaluate(() => { window.usabilityFixture.fail = 'NotAllowedError'; });
  await page.getByRole('button', { name: 'Start microphone check', exact: true }).click();
  await expect(page.getByText('Microphone access is blocked. Allow it in your browser and system privacy settings, then try again.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh microphones', exact: true }).click();
  await expect.poll(() => page.getByLabel('Microphone for this call', { exact: true }).locator('option').count()).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.usabilityFixture.raw.length)).toBe(0);
  await page.getByLabel('Microphone for this call', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start microphone check', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listen locally', exact: true })).toBeVisible();
  await page.evaluate(() => { window.usabilityFixture.raw.at(-1)!.enabled = false; });
  await expect(page.getByText('No signal detected. Check the selected input and hardware mute switch.', { exact: true })).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => { const t = window.usabilityFixture.raw.at(-1)!; t.stop(); t.dispatchEvent(new Event('ended')); });
  await expect(page.getByText('The microphone stopped. Start the check again.', { exact: true })).toBeVisible();
  await expect.poll(() => allStopped(page)).toBe(true);
});

test('push-to-talk ignores editing, gates release/focus loss, persists mode and cleans capture', async ({ page }, info) => {
  await setup(page); await ptt(page); expect(await page.evaluate(() => window.usabilityFixture.raw.length)).toBe(0);
  await workspaceLink(page, 'general'); await page.getByLabel('Message', { exact: true }).fill('v');
  await page.getByLabel('Message', { exact: true }).press('v'); expect(await page.evaluate(() => window.usabilityFixture.raw.length)).toBe(0);
  await hold(page).focus(); await page.keyboard.down('KeyV');
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  await expect.poll(() => gateValue(page)).toBe(1); const id = await page.evaluate(() => window.usabilityFixture.raw.at(-1)!.id);
  await page.keyboard.up('KeyV'); await expect(hold(page)).toHaveAttribute('aria-pressed', 'false'); await expect.poll(() => gateValue(page)).toBe(0);
  await page.keyboard.down('KeyV'); await expect.poll(() => gateValue(page)).toBe(1);
  expect(await page.evaluate(() => { window.dispatchEvent(new Event('blur')); return window.usabilityFixture.outputs.every(track => !track.enabled); })).toBe(true);
  await expect.poll(() => gateValue(page)).toBe(0); await page.keyboard.up('KeyV');
  await page.keyboard.down('KeyV'); await expect.poll(() => gateValue(page)).toBe(1);
  expect(await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); return window.usabilityFixture.outputs.every(track => !track.enabled); })).toBe(true);
  await expect.poll(() => gateValue(page)).toBe(0); await page.keyboard.up('KeyV'); await page.evaluate(() => Reflect.deleteProperty(document, 'hidden'));
  await page.keyboard.down('KeyV'); await expect.poll(() => gateValue(page)).toBe(1);
  await page.getByRole('button', { name: 'Deafen', exact: true }).click();
  expect(await page.evaluate(() => window.usabilityFixture.outputs.every(track => !track.enabled))).toBe(true);
  await expect.poll(() => gateValue(page)).toBe(0); await page.keyboard.up('KeyV');
  await page.getByRole('button', { name: 'Undeafen', exact: true }).click(); await expect(hold(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.usabilityFixture.raw.at(-1)!.id)).toBe(id);
  await audioSettings(page); await page.getByLabel('Push-to-talk key', { exact: true }).selectOption('KeyB');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await hold(page).focus();
  await page.keyboard.down('KeyV'); await expect.poll(() => gateValue(page)).toBe(0); await page.keyboard.up('KeyV');
  await page.keyboard.down('KeyB'); await expect.poll(() => gateValue(page)).toBe(1); await page.keyboard.up('KeyB'); await expect.poll(() => gateValue(page)).toBe(0);
  await audioSettings(page); await changeLanguage(page, 'ru');
  await page.getByLabel('Клавиша передачи голоса', { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('push-to-talk-ru.png'), fullPage: true });
  await page.getByRole('button', { name: 'Выйти из голосового канала', exact: true }).click(); await expect.poll(() => allStopped(page)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('dosvyazi-push-to-talk'))).toBe('true');
});

for (const phase of ['capture', 'offer'] as const) for (const action of ['release', 'leave'] as const) test(`push-to-talk ${action} before pending ${phase} never opens its gate`, async ({ page }) => {
  await setup(page); await ptt(page);
  await page.evaluate(phase => { window.usabilityFixture.holdCapture = phase === 'capture'; window.usabilityFixture.holdOffer = phase === 'offer'; }, phase);
  await hold(page).focus(); await page.keyboard.down('KeyV');
  await expect.poll(() => page.evaluate(() => window.usabilityFixture.releases.length)).toBeGreaterThan(0);
  if (action === 'leave') await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await page.keyboard.up('KeyV'); await expect.poll(() => gateValue(page)).toBe(0);
  await releaseFixtures(page);
  if (action === 'leave') { await expect.poll(() => allStopped(page)).toBe(true); await expect(hold(page)).toHaveCount(0); return; }
  await expect(hold(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toHaveAttribute('aria-pressed', 'false');
  if (phase === 'capture') await expect.poll(() => allStopped(page)).toBe(true);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click(); await expect.poll(() => allStopped(page)).toBe(true);
});

test('hold button supports mouse/touch and denial recovery without enabling continuous audio', async ({ page, context }, info) => {
  await context.grantPermissions(['microphone']); await setup(page); await ptt(page);
  await page.evaluate(() => { window.usabilityFixture.fail = 'NotReadableError'; });
  await hold(page).focus(); await page.keyboard.down('KeyV');
  await expect(page.getByText('Microphone capture failed. Check your system input settings, close other apps using the microphone, then try again.', { exact: true })).toBeVisible(); await page.keyboard.up('KeyV');
  await workspaceLink(page, 'general'); await page.getByLabel('Message', { exact: true }).focus();
  const box = (await hold(page).boundingBox())!;
  const cdp = await context.newCDPSession(page);
  if (info.project.name === 'mobile') await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  else { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); }
  await expect.poll(() => gateValue(page)).toBe(1);
  await page.keyboard.press('v'); await expect.poll(() => gateValue(page)).toBe(1);
  if (info.project.name === 'mobile') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
  await expect.poll(() => gateValue(page)).toBe(0);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click(); await expect.poll(() => allStopped(page)).toBe(true);
});

test('individual level and mute combine with master volume and survive deafen and a new audio publication', async ({ page, browser }, info) => {
  test.setTimeout(90_000); const speakerName = 'W'.repeat(40); await setup(page, speakerName); await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] });
  try {
    const peer = await otherContext.newPage(); await register(peer, 'Level receiver'); await peer.goto('/communities'); await peer.getByLabel('Invitation code', { exact: true }).fill(code); await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await joined(page); await page.getByRole('button', { name: 'Enable microphone', exact: true }).click(); await joined(peer); await audioSettings(peer);
    const slider = peer.getByRole('slider', { name: `${speakerName} playback volume`, exact: true });
    await slider.focus(); await slider.press('Home'); for (let i = 0; i < 50; i++) await slider.press('ArrowRight');
    const master = peer.getByRole('slider', { name: 'Output volume', exact: true }); await master.focus(); await master.press('End'); for (let i = 0; i < 20; i++) await master.press('ArrowLeft');
    await expect.poll(() => peer.locator('audio').evaluateAll(elements => elements.length > 0 && elements.every(e => Math.abs((e as HTMLAudioElement).volume - .4) < .0001))).toBe(true);
    await peer.getByRole('checkbox', { name: `Mute ${speakerName} for me`, exact: true }).check();
    await peer.getByRole('button', { name: 'Deafen', exact: true }).click(); await peer.getByRole('button', { name: 'Undeafen', exact: true }).click();
    expect(await peer.locator('audio').evaluateAll(elements => elements.every(e => (e as HTMLAudioElement).muted))).toBe(true);
    await audioSettings(page); await page.getByRole('checkbox', { name: 'Reduce audio quality', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Reduce audio quality', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Reduce audio quality', exact: true })).toBeEnabled();
    await expect.poll(() => peer.locator('audio').evaluateAll(elements => elements.length > 0 && elements.every(e => (e as HTMLAudioElement).muted && Math.abs((e as HTMLAudioElement).volume - .4) < .0001))).toBe(true);
    await peer.getByRole('checkbox', { name: `Mute ${speakerName} for me`, exact: true }).uncheck();
    await slider.scrollIntoViewIfNeeded(); expect(await peer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await peer.screenshot({ path: info.outputPath('participant-level-long-name.png'), fullPage: true });
    await expect.poll(() => peer.locator('audio').evaluateAll(elements => elements.every(e => !(e as HTMLAudioElement).muted))).toBe(true);
    await page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await hold(page).focus();
    await page.keyboard.down('KeyV'); await expect.poll(() => gateValue(page)).toBe(1);
    await expect.poll(() => receivedSignal(peer), { timeout: 10_000 }).toBeGreaterThan(.001);
    await page.keyboard.up('KeyV'); expect(await page.evaluate(() => window.usabilityFixture.outputs.every(track => !track.enabled))).toBe(true); await expect.poll(() => gateValue(page)).toBe(0);
    await expect.poll(() => receivedSignal(peer), { timeout: 10_000 }).toBeLessThan(.0001);
    await audioSettings(page); await page.getByRole('checkbox', { name: 'Hold to transmit microphone audio', exact: true }).uncheck();
    await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
    await expect.poll(() => allStopped(page)).toBe(true);
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect.poll(() => receivedSignal(peer), { timeout: 10_000 }).toBeGreaterThan(.001);
    await peer.getByRole('button', { name: 'Leave voice', exact: true }).click(); await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  } finally { await otherContext.close(); }
});

test('Speak revocation closes a held PTT source and restored permission still needs a new hold', async ({ page, browser }) => {
  test.setTimeout(90_000); await setup(page); const root = '/api/v1' + new URL(page.url()).pathname;
  await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] });
  try {
    const peer = await other.newPage(); await register(peer, 'PTT member'); await peer.goto('/communities');
    await peer.getByLabel('Invitation code', { exact: true }).fill(code); await peer.getByRole('button', { name: 'Join community', exact: true }).click();
    await joined(page); await ptt(peer); await hold(peer).focus(); await peer.keyboard.down('KeyV');
    await expect.poll(() => receivedSignal(page), { timeout: 10_000 }).toBeGreaterThan(.001);
    const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
    const policy = await (await page.request.get(root + '/access')).json() as { roles: { id: string; name: string }[]; voiceRules: { resourceId: string; roleId: string; allow: number; deny: number }[] };
    const everyone = policy.roles.find(role => role.name === 'everyone')!.id;
    policy.voiceRules = [{ resourceId: everyone, roleId: everyone, allow: 0, deny: 4096 }];
    expect((await page.request.put(root + '/access', { headers: { 'X-CSRF-TOKEN': csrf.requestToken }, data: { clientRequestId: crypto.randomUUID(), policy } })).status()).toBe(200);
    await expect(hold(peer)).toBeDisabled({ timeout: 25_000 }); await expect.poll(() => allStopped(peer), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => receivedSignal(page), { timeout: 10_000 }).toBeLessThan(.0001); await peer.keyboard.up('KeyV');
    const restoredPolicy = await (await page.request.get(root + '/access')).json() as typeof policy;
    restoredPolicy.voiceRules = [];
    expect((await page.request.put(root + '/access', { headers: { 'X-CSRF-TOKEN': csrf.requestToken }, data: { clientRequestId: crypto.randomUUID(), policy: restoredPolicy } })).status()).toBe(200);
    await expect(hold(peer)).toBeEnabled({ timeout: 25_000 }); await expect(hold(peer)).toHaveAttribute('aria-pressed', 'false');
    expect(await allStopped(peer)).toBe(true);
    await peer.getByRole('button', { name: 'Leave voice', exact: true }).click(); await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  } finally { await other.close(); }
});
