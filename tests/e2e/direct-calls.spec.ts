import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SignalResponse } from '@livekit/protocol';
import type { VoiceJoin } from '../../apps/web/src/api/voice';
import { startScreenShare, workspaceLink } from './workspace-navigation';

test.setTimeout(100_000);
test.use({ serviceWorkers: 'block' });
async function command(page: Page, path: string, data?: unknown) {
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  return page.request.post(path, { data, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
}
async function register(page: Page, name: string) {
  const response = await command(page, '/api/v1/account/register', { email: `call-${crypto.randomUUID()}@example.test`, password: 'Synthetic direct call passphrase 42', displayName: name });
  expect(response.status()).toBe(201); return await response.json() as { id: string };
}
async function sources(page: Page) {
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = []; (window as unknown as { callTracks: MediaStreamTrack[] }).callTracks = tracks;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await capture(options); tracks.push(...stream.getTracks()); return stream; };
    navigator.mediaDevices.getDisplayMedia = async options => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d')!, stream = canvas.captureStream(15); const video = stream.getVideoTracks()[0]!;
      const draw = () => { if (video.readyState === 'ended') return; context.fillStyle = '#285c50'; context.fillRect(0, 0, 640, 360); requestAnimationFrame(draw); }; draw();
      if (options?.audio) {
        const audio = new AudioContext(), tone = audio.createOscillator(), gain = audio.createGain(), output = audio.createMediaStreamDestination();
        tone.frequency.value = 880; gain.gain.value = .06; tone.connect(gain); gain.connect(output); tone.start(); await audio.resume();
        const sound = output.stream.getAudioTracks()[0]!, stop = sound.stop.bind(sound); sound.stop = () => { stop(); void audio.close(); }; stream.addTrack(sound);
      }
      tracks.push(...stream.getTracks()); return stream;
    };
  });
}
const connected = (page: Page) => expect(page.getByRole('region', { name: 'Voice controls', exact: true })).toContainText('Connected', { timeout: 20_000 });
const live = (page: Page) => page.evaluate(() => (window as unknown as { callTracks: MediaStreamTrack[] }).callTracks.filter(track => track.readyState === 'live').map(track => track.id).sort());

test('personal call uses protected SFU with shared media controls and survives SPA navigation', async ({ page, browser, context }, info) => {
  await context.grantPermissions(['microphone', 'camera']); await sources(page); await register(page, 'Call sender');
  const peerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  try {
    const peer = await peerContext.newPage(); await sources(peer); const person = await register(peer, 'Call recipient');
    const created = await command(page, '/api/v1/direct-messages', { clientRequestId: crypto.randomUUID(), userId: person.id }); expect(created.status()).toBe(201);
    const conversation = await created.json() as { id: string };
    await page.goto(`/messages/${conversation.id}`); await peer.goto('/');
    let refreshed = ''; page.on('websocket', socket => socket.on('framereceived', frame => {
      if (!Buffer.isBuffer(frame.payload)) return;
      const message = SignalResponse.fromBinary(frame.payload).message;
      if (message.case === 'refreshToken') refreshed = message.value;
    }));
    const started = page.waitForResponse(r => r.url().endsWith(`/direct-calls/conversation/${conversation.id}`) && r.request().method() === 'POST' && r.status() === 200);
    await page.getByRole('button', { name: 'Start personal call', exact: true }).click(); const call = await (await started).json() as { id: string };
    await expect(page.getByRole('region', { name: 'Outgoing call', exact: true })).toContainText('Calling…');
    await expect(peer.getByRole('region', { name: 'Incoming call', exact: true })).toContainText('Call sender');
    expect(await live(page)).toHaveLength(0); expect(await live(peer)).toHaveLength(0);
    const issued = page.waitForResponse(r => r.url().endsWith(`/direct-calls/${call.id}/join`) && r.status() === 200);
    await peer.getByRole('button', { name: 'Answer call', exact: true }).click(); const grant = await (await issued).json() as VoiceJoin;
    await connected(page); await connected(peer);
    await expect(peer.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
    expect(await live(page)).toHaveLength(0); expect(await live(peer)).toHaveLength(0);
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect(peer.locator('audio')).toHaveCount(1, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click(); await startScreenShare(page, true);
    await peer.getByRole('button', { name: /^View shared video/ }).click();
    await expect(peer.getByRole('region', { name: 'Shared video', exact: true }).locator('video')).toHaveCount(2, { timeout: 15_000 });
    await expect(peer.locator('audio')).toHaveCount(2); const tracks = await live(page); expect(tracks).toHaveLength(4);
    await expect.poll(() => refreshed.length, { timeout: 12_000 }).toBeGreaterThan(0);
    const headers = { Origin: 'http://127.0.0.1:5174' };
    expect((await page.request.get('/livekit/direct/rtc/validate?' + new URLSearchParams({ access_token: refreshed }), { headers })).status()).toBe(200);
    await workspaceLink(page, 'My bookmarks'); await connected(page); expect(await live(page)).toEqual(tracks);
    await page.getByRole('region', { name: 'Voice controls', exact: true }).getByRole('link').click(); await connected(page);
    await expect(page).toHaveURL(new RegExp(`/messages/${conversation.id}$`));
    const screen = peer.getByRole('region', { name: 'Shared video', exact: true }).locator('figure').filter({ hasText: 'Screen share' });
    await screen.getByRole('button', { name: 'Open fullscreen', exact: true }).click();
    await expect.poll(() => peer.evaluate(() => !!document.fullscreenElement)).toBe(true); await peer.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('personal-call-media.png') });
    await peer.getByRole('button', { name: 'Leave voice', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Voice controls', exact: true })).toHaveCount(0, { timeout: 12_000 });
    await expect.poll(() => live(page)).toHaveLength(0); await expect.poll(() => live(peer)).toHaveLength(0);
    for (const token of [grant.token, refreshed]) {
      expect((await page.request.get('/livekit/direct/rtc/validate?' + new URLSearchParams({ access_token: token }), { headers })).status()).toBe(401);
      const reopened = await page.evaluate(({ url, token }) => new Promise<boolean>(resolve => {
        const socket = new WebSocket(`${url}/rtc?${new URLSearchParams({ access_token: token })}`);
        const timer = setTimeout(() => { socket.close(); resolve(false); }, 4000);
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true); }; socket.onerror = () => { clearTimeout(timer); resolve(false); };
      }), { url: grant.url, token }); expect(reopened).toBe(false);
    }
  } finally { await peerContext.close(); }
});

test('personal ringing can be declined and retried without acquiring media', async ({ page, browser }) => {
  await sources(page); await register(page, 'Declined caller'); const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()! });
  try {
    const peer = await context.newPage(); await sources(peer); const person = await register(peer, 'Declining recipient');
    const response = await command(page, '/api/v1/direct-messages', { clientRequestId: crypto.randomUUID(), userId: person.id }); const conversation = await response.json() as { id: string };
    await page.goto(`/messages/${conversation.id}`); await peer.goto('/');
    await page.getByRole('button', { name: 'Start personal call', exact: true }).click();
    await peer.getByRole('button', { name: 'Decline call', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Outgoing call', exact: true })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Start personal call', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Start personal call', exact: true }).click();
    await expect(peer.getByRole('region', { name: 'Incoming call', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel call', exact: true }).click();
    await expect(peer.getByRole('region', { name: 'Incoming call', exact: true })).toHaveCount(0, { timeout: 10_000 });
    expect(await live(page)).toHaveLength(0); expect(await live(peer)).toHaveLength(0);
  } finally { await context.close(); }
});
