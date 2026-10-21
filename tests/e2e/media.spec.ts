import { audioSettings, communityOverview, joinVoice, workspaceLink } from './workspace-navigation';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { components } from '../../apps/web/src/api/schema';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const livekitSdkFile = path.join(path.dirname(fileURLToPath(import.meta.resolve('livekit-client'))), 'livekit-client.umd.js');

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`media-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic media browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}

// This deliberately substitutes a generated canvas for the human browser source picker.
// Actual getUserMedia/encoding/SFU/subscription/decoding still run; physical acceptance is separate.
async function syntheticScreen(page: Page) {
  await page.addInitScript(() => {
    const fixtures = { tracks: [] as MediaStreamTrack[], mode: 'normal', resolve: null as (() => void) | null };
    (window as unknown as { mediaFixture: typeof fixtures }).mediaFixture = fixtures;
    navigator.mediaDevices.getDisplayMedia = async options => {
      if (fixtures.mode === 'cancel') throw new DOMException('Synthetic cancellation', 'NotAllowedError');
      if (fixtures.mode === 'delay') await new Promise<void>(resolve => { fixtures.resolve = resolve; });
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d')!; context.fillStyle = '#327b62'; context.fillRect(0, 0, 640, 360);
      const stream = canvas.captureStream(15); fixtures.tracks.push(...stream.getTracks());
      function draw() { if (stream.getVideoTracks()[0]!.readyState === 'ended') return; context.fillRect(0, 0, 640, 360); requestAnimationFrame(draw); }
      requestAnimationFrame(draw);
      if (options?.audio && fixtures.mode !== 'no-audio') {
        const audio = new AudioContext(); const oscillator = audio.createOscillator();
        const destination = audio.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start();
        const track = destination.stream.getAudioTracks()[0]!;
        track.addEventListener('ended', () => { oscillator.stop(); void audio.close(); }, { once: true });
        fixtures.tracks.push(track); stream.addTrack(track);
      }
      return stream;
    };
  });
}

async function expectVideosDecoded(page: Page) {
  await page.bringToFront();
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  // Adaptive subscriptions intentionally pause offscreen tiles; reveal each before asserting decoding.
  for (const video of await page.locator('.voice-videos video').all()) {
    await video.scrollIntoViewIfNeeded();
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoWidth), { timeout: 15000 }).toBeGreaterThan(0);
  }
}

test('camera and screen video coexist with microphone, focus, deafen and access revocation', async ({ page, browser }, info) => {
  test.setTimeout(110_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await syntheticScreen(page); await register(page, 'Media owner');
  await page.goto('/communities'); await page.getByLabel('Community name', { exact: true }).fill('Media crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Media crew', exact: true })).toBeVisible();
  const root = `/api/v1${new URL(page.url()).pathname}`;
  await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  try {
    const member = await context.newPage(); member.on('pageerror', error => errors.push(error.message));
    await syntheticScreen(member); await register(member, 'Media peer'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await joinVoice(page); await joinVoice(member);
    // Control-service admission may retry after 10 seconds; bound that recovery separately from capture assertions.
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected', { timeout: 20_000 });
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Connected', { timeout: 20_000 });
    await expect(member.locator('.voice-videos video')).toHaveCount(0);
    await member.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(member.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'View shared video (1)', exact: true }).click();
    await member.getByRole('button', { name: 'View shared video (1)', exact: true }).click();
    await expect(page.locator('.voice-videos video')).toHaveCount(1, { timeout: 15000 });
    await expectVideosDecoded(page);
    await audioSettings(member);
  await member.getByLabel('Include screen audio when available', { exact: true }).check();
    await member.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(member.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
    await expect(page.locator('.voice-videos video')).toHaveCount(2, { timeout: 15000 });
    await expectVideosDecoded(page);
    await member.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect(member.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
    await member.getByRole('button', { name: 'Deafen', exact: true }).click();
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Deafened');
    await expect(member.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled();
    await expect(member.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
    await member.getByRole('button', { name: 'Undeafen', exact: true }).click();
    await workspaceLink(member, 'general');
    await expect(member.getByRole('heading', { name: '#general' })).toBeVisible();
    await expect(member.locator('.voice-videos video')).toHaveCount(2);
    await page.screenshot({ path: info.outputPath('video-gallery.png'), fullPage: true });
    await page.getByRole('button', { name: 'Focus video', exact: true }).last().click();
    await expect(page.locator('.voice-video-tile.is-focused')).toHaveCount(1);
    await expect(page.locator('main')).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('shared-media.png'), fullPage: true });
    await member.getByRole('button', { name: 'Stop your screen share', exact: true }).click();
    await expect(page.locator('.voice-video-tile.is-focused')).toHaveCount(0);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.voice-videos video')).toHaveCount(1);
    await member.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(page.locator('.voice-videos video')).toHaveCount(2);
    const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
    const policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy'];
    const everyone = policy.roles.find(role => role.name === 'everyone')!.id;
    policy.voiceRules = [{ resourceId: everyone, roleId: everyone, allow: 0, deny: 16384 }];
    expect((await page.request.put(root + '/access', { headers: { 'X-CSRF-TOKEN': csrf.requestToken }, data: { clientRequestId: crypto.randomUUID(), policy } })).status()).toBe(200);
    await expect(member.locator('.voice-videos video')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('.voice-videos video')).toHaveCount(0, { timeout: 15000 });
    await expect(member.getByRole('button', { name: 'Enable camera', exact: true })).toBeEnabled({ timeout: 25000 });
    await expect(member.getByRole('button', { name: 'Share screen', exact: true })).toBeDisabled();
    await expect.poll(() => member.evaluate(() => (window as unknown as { mediaFixture: { tracks: MediaStreamTrack[] } }).mediaFixture.tracks.every(track => track.readyState === 'ended'))).toBe(true);
    await member.getByRole('button', { name: 'Enable camera', exact: true }).click();
    // A generation transition reconnects both clients and resets viewing consent.
    await page.getByRole('button', { name: 'View shared video (1)', exact: true }).click();
    await expect(page.locator('.voice-videos video')).toHaveCount(1, { timeout: 15000 });
    await member.getByRole('button', { name: 'Stop camera', exact: true }).click();
    await expect(page.locator('.voice-videos video')).toHaveCount(0);
    await member.getByRole('button', { name: 'Leave voice', exact: true }).click();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('third participant leaving preserves peer sessions, camera and screen publications', async ({ page, browser, context }) => {
  test.setTimeout(75_000);
  await context.grantPermissions(['microphone', 'camera']);
  await syntheticScreen(page); await register(page, 'Continuity publisher'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Continuous media');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Continuous media', exact: true })).toBeVisible();
  const community = new URL(page.url()).pathname.split('/')[2]!;
  await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] })));
  try {
    const receiver = await contexts[0]!.newPage(); const departing = await contexts[1]!.newPage();
    for (const [peer, name] of [[receiver, 'Continuity receiver'], [departing, 'Continuity departure']] as const) {
      await register(peer, name); await peer.goto('/communities');
      await peer.getByLabel('Invitation code', { exact: true }).fill(code);
      await peer.getByRole('button', { name: 'Join community', exact: true }).click();
      await joinVoice(peer);
      await expect(peer.getByRole('region', { name: 'Voice controls' })).toContainText('Connected', { timeout: 20_000 });
    }
    await joinVoice(page);
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await page.getByRole('button', { name: 'Share screen', exact: true }).click();
    await receiver.getByRole('button', { name: 'View shared video (2)', exact: true }).click();
    await expectVideosDecoded(receiver);
    const tracks = () => receiver.locator('.voice-videos video').evaluateAll(videos => videos.map(video => ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks().map(track => track.id)).flat().sort());
    await expect(receiver.locator('.voice-videos video')).toHaveCount(2);
    const before = await tracks();
    let rejoined = 0;
    for (const peer of [page, receiver]) peer.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/voice/join')) rejoined++; });
    await departing.getByRole('button', { name: 'Leave voice', exact: true }).click();
    await expect(departing.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
    await expect.poll(async () => {
      const state = await (await page.request.get(`/api/v1/communities/${community}/voice`)).json() as { participants: unknown[] };
      return state.participants.length;
    }).toBe(2);
    // Observe several reconciler/client polls; a forced transition stops captures
    // and issues another join even if its reconnect happens between assertions.
    await page.waitForTimeout(8_000);
    expect(rejoined).toBe(0);
    await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
    expect(await tracks()).toEqual(before);
    await expectVideosDecoded(receiver);
    expect(await page.evaluate(() => (window as unknown as { mediaFixture: { tracks: MediaStreamTrack[] } }).mediaFixture.tracks.every(track => track.readyState === 'live'))).toBe(true);
    await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
    await receiver.getByRole('button', { name: 'Leave voice', exact: true }).click();
  } finally { await Promise.all(contexts.map(peer => peer.close())); }
});

test('screen cancellation and late picker result keep capture off after leaving', async ({ page }) => {
  await syntheticScreen(page); await register(page, 'Media lifecycle'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Capture lifecycle'); await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capture lifecycle' })).toBeVisible();
  await joinVoice(page);
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
  await page.evaluate(() => { (window as unknown as { mediaFixture: { mode: string } }).mediaFixture.mode = 'cancel'; });
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
  await page.evaluate(() => { (window as unknown as { mediaFixture: { mode: string } }).mediaFixture.mode = 'delay'; });
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { mediaFixture: { resolve: (() => void) | null } }).mediaFixture.resolve!(); });
  await expect.poll(() => page.evaluate(() => {
    const tracks = (window as unknown as { mediaFixture: { tracks: MediaStreamTrack[] } }).mediaFixture.tracks;
    return tracks.length > 0 && tracks.every(track => track.readyState === 'ended');
  })).toBe(true);
  await expect(page.locator('.voice-videos video')).toHaveCount(0);
});

test('camera denial is recoverable and offline recovery never recaptures media', async ({ page, context }) => {
  test.setTimeout(65000);
  await syntheticScreen(page);
  await page.addInitScript(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const fixture = { denied: true, tracks: [] as MediaStreamTrack[] };
    (window as unknown as { cameraFixture: typeof fixture }).cameraFixture = fixture;
    navigator.mediaDevices.getUserMedia = async options => {
      if (options?.video && fixture.denied) throw new DOMException('Synthetic camera denial', 'NotAllowedError');
      const stream = await acquire(options); if (options?.video) fixture.tracks.push(...stream.getVideoTracks()); return stream;
    };
  });
  await register(page, 'Capture recovery'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Recovery crew'); await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recovery crew' })).toBeVisible();
  await joinVoice(page);
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByText('Camera unavailable. Allow camera access and check the selected device, then try again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
  await page.evaluate(() => { (window as unknown as { cameraFixture: { denied: boolean } }).cameraFixture.denied = false; });
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { mediaFixture: { mode: string } }).mediaFixture.mode = 'no-audio'; });
  await audioSettings(page);
  await page.getByLabel('Include screen audio when available', { exact: true }).check();
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
  await expect(page.getByText('This source or browser did not provide screen audio. Your screen is still shared.', { exact: true })).toBeVisible();
  // Emulate the browser's Stop sharing, which ends capture and emits an ended event.
  await page.evaluate(() => {
    const track = (window as unknown as { mediaFixture: { tracks: MediaStreamTrack[] } }).mediaFixture.tracks[0]!;
    track.stop(); track.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toBeEnabled();
  await expect(page.getByText('This source or browser did not provide screen audio. Your screen is still shared.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Offline');
  await expect.poll(() => page.evaluate(() => {
    const fixtures = window as unknown as { mediaFixture: { tracks: MediaStreamTrack[] }; cameraFixture: { tracks: MediaStreamTrack[] } };
    return [...fixtures.mediaFixture.tracks, ...fixtures.cameraFixture.tracks].every(track => track.readyState === 'ended');
  })).toBe(true);
  await context.setOffline(false);
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected', { timeout: 25000 });
  await expect(page.getByRole('button', { name: 'Enable camera', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Share screen', exact: true })).toBeEnabled();
  await expect(page.locator('.voice-videos video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
});

test('SFU rejects camera and screen publication even if a client bypasses its own source checks', async ({ page, browser }) => {
  test.setTimeout(90000);
  await register(page, 'Media grant owner'); await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Source denial crew'); await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Source denial crew' })).toBeVisible();
  const root = `/api/v1${new URL(page.url()).pathname}`;
  await communityOverview(page); await page.getByRole('button', { name: 'Create invitation', exact: true }).click(); const code = await page.getByLabel('Share this invitation code').inputValue();
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  const policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy'];
  const everyone = policy.roles.find(role => role.name === 'everyone')!.id;
  policy.voiceRules = [{ resourceId: everyone, roleId: everyone, allow: 0, deny: 16384 | 32768 }];
  expect((await page.request.put(root + '/access', { headers: { 'X-CSRF-TOKEN': csrf.requestToken }, data: { clientRequestId: crypto.randomUUID(), policy } })).status()).toBe(200);
  await joinVoice(page);
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174' });
  try {
    const rogue = await context.newPage(); await register(rogue, 'Denied media sender'); await rogue.goto('/communities');
    await rogue.getByLabel('Invitation code', { exact: true }).fill(code); await rogue.getByRole('button', { name: 'Join community', exact: true }).click();
    await rogue.addScriptTag({ path: livekitSdkFile });
    const outcomes = await rogue.evaluate(async voiceRoot => {
      const sdk = (window as unknown as { LivekitClient: typeof import('livekit-client') }).LivekitClient;
      const csrf = await (await fetch('/api/v1/account/csrf')).json() as { requestToken: string };
      const outcomes: boolean[] = [];
      for (const source of [sdk.Track.Source.Camera, sdk.Track.Source.ScreenShare]) {
        const response = await fetch(voiceRoot + '/voice/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf.requestToken }, body: JSON.stringify({ clientRequestId: crypto.randomUUID() }) });
        if (!response.ok) {
          const problem = await response.json() as { title?: string; code?: string };
          throw new Error(`Synthetic media join failed: HTTP ${response.status} ${problem.code ?? ''} ${problem.title ?? ''}`);
        }
        const grant = await response.json() as components['schemas']['VoiceJoinDto'];
        if (grant.canUseCamera || grant.canShareScreen || !grant.canSpeak) throw new Error('Unexpected media grant');
        const room = new sdk.Room(); const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        canvas.getContext('2d')!.fillRect(0, 0, 320, 180); const native = canvas.captureStream(15).getVideoTracks()[0]!;
        const track = new sdk.LocalVideoTrack(native, undefined, true); track.source = source;
        try {
          await room.connect(grant.url, grant.token);
          // Bypass only the local SDK check. The signed JWT's microphone-only grant is unchanged.
          room.localParticipant.permissions!.canPublishSources = [];
          let rejected = false;
          try { await room.localParticipant.publishTrack(track, { source, simulcast: false }); }
          catch { rejected = true; }
          outcomes.push(rejected);
        } finally { track.stop(); await room.disconnect(); }
      }
      return outcomes;
    }, root);
    expect(outcomes).toEqual([true, true]);
    await expect(page.getByRole('region', { name: 'Shared video' })).toHaveCount(0);
  } finally { await context.close(); }
});
