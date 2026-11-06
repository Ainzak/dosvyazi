import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SignalResponse } from '@livekit/protocol';
import type { components } from '../../apps/web/src/api/schema';
import { changeLanguage, startScreenShare, workspaceLink } from './workspace-navigation';

const origin = process.env.DOSVYAZI_BROWSER_ORIGIN ?? 'http://127.0.0.1:5174';
test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);
type Details = components['schemas']['CommunityDetails'];
type Grant = components['schemas']['VoiceJoinDto'];
async function command(page: Page, path: string, data: unknown, method = 'POST') {
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  return page.request.fetch(path, { method, data, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
}
async function register(page: Page, name: string) {
  expect((await command(page, '/api/v1/account/register', { email: `admission-${crypto.randomUUID()}@example.test`, password: 'Synthetic admission browser 42', displayName: name })).status()).toBe(201);
}
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = []; (window as unknown as { admissionTracks: MediaStreamTrack[] }).admissionTracks = tracks;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await capture(options); tracks.push(...stream.getTracks()); return stream; };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d')!, stream = canvas.captureStream(15); tracks.push(...stream.getTracks());
      function draw() { if (stream.getVideoTracks()[0]!.readyState === 'ended') return; context.fillStyle = '#327b62'; context.fillRect(0, 0, 640, 360); requestAnimationFrame(draw); }
      draw(); return stream;
    };
  });
}
const connected = (page: Page) => expect(page.getByRole('region', { name: 'Voice controls', exact: true })).toContainText('Connected', { timeout: 20_000 });
const live = (page: Page) => page.evaluate(() => (window as unknown as { admissionTracks: MediaStreamTrack[] }).admissionTracks.filter(t => t.readyState === 'live').map(t => t.id).sort());

test('protected moderator disconnect rejects original and SFU-refreshed tokens while two peers keep media', async ({ page, browser, context }, info) => {
  await context.grantPermissions(['microphone', 'camera']); await fixture(page); await register(page, 'Admission owner');
  const created = await command(page, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'Protected voice crew' }); expect(created.status()).toBe(201);
  const community = await created.json() as Details; const root = `/api/v1/communities/${community.id}`;
  const invitation = await (await command(page, root + '/invites', { clientRequestId: crypto.randomUUID(), lifetimeHours: 1, maxUses: 2 })).json() as { code: string };
  const peerContext = await browser.newContext({ baseURL: origin, viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  const targetContext = await browser.newContext({ baseURL: origin, viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  let ownerJoins = 0, peerJoins = 0, ownerSignals = 0, peerSignals = 0, refreshed = '';
  page.on('response', r => { if (r.request().method() === 'POST' && r.url().endsWith('/voice/join') && r.status() === 200) ownerJoins++; });
  page.on('websocket', ws => { if (new URL(ws.url()).pathname.startsWith('/livekit/rtc')) ownerSignals++; });
  try {
    const peer = await peerContext.newPage(), target = await targetContext.newPage();
    await fixture(peer); await register(peer, 'Continuity peer'); await register(target, 'Removed member');
    peer.on('response', r => { if (r.request().method() === 'POST' && r.url().endsWith('/voice/join') && r.status() === 200) peerJoins++; });
    peer.on('websocket', ws => { if (new URL(ws.url()).pathname.startsWith('/livekit/rtc')) peerSignals++; });
    target.on('websocket', ws => { if (new URL(ws.url()).pathname.startsWith('/livekit/rtc')) ws.on('framereceived', frame => {
      const signal = typeof frame.payload === 'string' ? SignalResponse.fromJson(JSON.parse(frame.payload)) : SignalResponse.fromBinary(frame.payload);
      if (signal.message.case === 'refreshToken') refreshed = signal.message.value;
    }); });
    for (const member of [peer, target]) { expect((await command(member, '/api/v1/communities/join', { code: invitation.code })).status()).toBe(200); await member.goto(`/communities/${community.id}/voice`); }
    await page.goto(`/communities/${community.id}/voice`);
    for (const member of [page, peer]) {
      await member.getByRole('button', { name: 'Join voice', exact: true }).click(); await connected(member);
      await member.getByRole('button', { name: 'Enable microphone', exact: true }).click();
      await member.getByRole('button', { name: 'Enable camera', exact: true }).click(); await startScreenShare(member, false);
      await expect.poll(() => live(member)).toHaveLength(3);
    }
    const response = target.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/voice/join') && r.status() === 200);
    await target.getByRole('button', { name: 'Join voice', exact: true }).click(); const grant = await (await response).json() as Grant; await connected(target);
    await expect.poll(() => refreshed.length, { timeout: 12_000 }).toBeGreaterThan(0);
    expect((await target.request.get('/livekit/rtc/validate?' + new URLSearchParams({ access_token: refreshed }), { headers: { Origin: origin } })).status()).toBe(200);
    const initial = [await live(page), await live(peer)], counts = [ownerJoins, peerJoins, ownerSignals, peerSignals];
    const state = await (await page.request.get(root + '/voice')).json() as components['schemas']['VoiceStateDto']; expect(state.participants).toHaveLength(3);
    await page.getByRole('button', { name: 'Disconnect Removed member', exact: true }).click();
    await expect(target.getByRole('region', { name: 'Voice controls', exact: true })).toHaveCount(0, { timeout: 12_000 });
    await expect(target.getByRole('alert')).toContainText('A moderator disconnected you');
    for (const token of [grant.token, refreshed]) {
      const denied = await target.request.get('/livekit/rtc/validate?' + new URLSearchParams({ access_token: token }), { headers: { Origin: origin } }); expect(denied.status()).toBe(401);
      const opened = await target.evaluate(({ url, token }) => new Promise<boolean>(resolve => {
        const socket = new WebSocket(`${url}/rtc?${new URLSearchParams({ access_token: token })}`);
        const timeout = setTimeout(() => { socket.close(); resolve(false); }, 5000);
        socket.onopen = () => { clearTimeout(timeout); socket.close(); resolve(true); }; socket.onerror = () => { clearTimeout(timeout); resolve(false); };
      }), { url: grant.url, token }); expect(opened).toBe(false);
    }
    await expect.poll(async () => (await (await page.request.get(root + '/voice')).json() as components['schemas']['VoiceStateDto']).participants.length).toBe(2);
    await connected(page); await connected(peer); expect(await live(page)).toEqual(initial[0]); expect(await live(peer)).toEqual(initial[1]);
    expect([ownerJoins, peerJoins, ownerSignals, peerSignals]).toEqual(counts);
    const after = await (await page.request.get(root + '/voice')).json() as components['schemas']['VoiceStateDto']; expect(after.generation).toBe(state.generation); expect(after.status).toBe('Ready');
    await page.screenshot({ path: info.outputPath('protected-three-client-continuity.png') });
    const listenerResponse = peer.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/voice/join') && r.status() === 200);
    const policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy'];
    policy.voiceRules = [{ resourceId: community.id, roleId: community.id, allow: 0, deny: 4096 }];
    expect((await command(page, root + '/access', { clientRequestId: crypto.randomUUID(), policy }, 'PUT')).status()).toBe(200);
    const listener = await (await listenerResponse).json() as Grant; expect(listener.canSpeak).toBe(false); expect(listener.generation).toBe(grant.generation);
    await connected(peer); await expect(peer.getByRole('button', { name: 'Enable microphone', exact: true })).toBeDisabled();
    await expect(peer.getByRole('alert').filter({ hasText: 'A moderator disconnected you' })).toHaveCount(0);
    expect(await live(page)).toEqual(initial[0]); expect(ownerJoins).toBe(counts[0]); expect(ownerSignals).toBe(counts[2]);

    await page.getByRole('button', { name: 'Leave voice', exact: true }).click(); await peer.getByRole('button', { name: 'Leave voice', exact: true }).click();
  } finally { await targetContext.close(); await peerContext.close(); }
});

test('create a named voice channel, edit its rules, move explicitly and retain Russian mobile navigation', async ({ page, context, browser }, info) => {
  await context.grantPermissions(['microphone', 'camera']); await fixture(page); await register(page, 'Channels owner');
  const created = await command(page, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'Named voice crew' }); const community = await created.json() as Details;
  await page.goto(`/communities/${community.id}`); await page.getByRole('button', { name: 'Manage access', exact: true }).click();
  await page.getByLabel('New voice channel', { exact: true }).fill('Games'); await page.getByRole('button', { name: 'Add voice channel', exact: true }).click();
  await page.getByLabel('Resource type', { exact: true }).selectOption('voiceRules'); await page.getByLabel('Resource', { exact: true }).selectOption({ label: 'Games' });
  await page.getByLabel('UseCamera rule', { exact: true }).selectOption('Deny'); await page.getByRole('button', { name: 'Save access', exact: true }).click();
  await expect(page.getByText('Access settings loaded', { exact: true })).toBeVisible();
  const details = await (await page.request.get(`/api/v1/communities/${community.id}`)).json() as Details; const games = details.voiceChannels!.find(c => c.name === 'Games')!;
  const root = `/api/v1/communities/${community.id}`;
  const saved = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy'];
  saved.voiceRules = [...saved.voiceRules ?? [], { resourceId: community.id, roleId: community.id, allow: 0, deny: 1 }];
  expect((await command(page, root + '/access', { clientRequestId: crypto.randomUUID(), policy: saved }, 'PUT')).status()).toBe(200);
  const invitation = await (await command(page, root + '/invites', { clientRequestId: crypto.randomUUID(), lifetimeHours: 1, maxUses: 1 })).json() as { code: string };
  const memberContext = await browser.newContext({ baseURL: origin, viewport: page.viewportSize()!, permissions: ['microphone', 'camera'] });
  try {
    const member = await memberContext.newPage(); await register(member, 'Private channel member');
    expect((await command(member, '/api/v1/communities/join', { code: invitation.code })).status()).toBe(200);
    await member.goto(`/communities/${community.id}/voice/${games.id}`); await member.getByRole('button', { name: 'Join voice', exact: true }).click(); await connected(member);
    await expect(member.getByRole('button', { name: 'Enable camera', exact: true })).toBeDisabled();
    expect((await member.request.get(root + '/voice')).status()).toBe(404);

  await workspaceLink(page, 'Voice room'); await page.getByRole('button', { name: 'Join voice', exact: true }).click(); await connected(page);
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click(); await expect.poll(() => live(page)).toHaveLength(1);
  await workspaceLink(page, 'Games'); await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move to this voice channel', exact: true }).click(); await connected(page);
  await expect(page.getByRole('button', { name: 'Enable camera', exact: true })).toBeEnabled(); // Owner retains override.
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled(); expect(await live(page)).toEqual([]);
  const state = await (await page.request.get(`/api/v1/communities/${community.id}/voice/channels/${games.id}`)).json() as components['schemas']['VoiceStateDto']; expect(state.myLeaseId).not.toBeNull();
  const previous = await (await page.request.get(`/api/v1/communities/${community.id}/voice`)).json() as components['schemas']['VoiceStateDto']; expect(previous.myLeaseId).toBeNull();
  await changeLanguage(page, 'ru'); await expect(page.getByRole('heading', { name: 'Games', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Управление голосом', exact: true })).toContainText('Подключено');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('named-voice-channel-ru.png') }); await page.getByRole('button', { name: 'Выйти из голосового канала', exact: true }).click();
    await connected(member); await expect(member.getByRole('heading', { name: 'Games', exact: true })).toBeVisible();
    await member.getByRole('button', { name: 'Leave voice', exact: true }).click();
  } finally { await memberContext.close(); }

});


test('a live SFU-refreshed grant resumes signaling without creating a new application lease', async ({ page }) => {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = []; (window as unknown as { admissionSockets: WebSocket[] }).admissionSockets = sockets;
    window.WebSocket = new Proxy(WebSocket, { construct(target, args) {
      const socket = Reflect.construct(target, args) as WebSocket;
      if (new URL(String(args[0])).pathname.startsWith('/livekit/rtc')) sockets.push(socket);
      return socket;
    } });
  });
  let joins = 0, signals = 0, refreshed = '';
  page.on('response', r => { if (r.request().method() === 'POST' && r.url().endsWith('/voice/join') && r.status() === 200) joins++; });
  page.on('websocket', ws => { if (new URL(ws.url()).pathname.startsWith('/livekit/rtc')) { signals++; ws.on('framereceived', frame => {
    const signal = typeof frame.payload === 'string' ? SignalResponse.fromJson(JSON.parse(frame.payload)) : SignalResponse.fromBinary(frame.payload);
    if (signal.message.case === 'refreshToken') refreshed = signal.message.value;
  }); } });
  await register(page, 'Signal resume owner');
  const community = await (await command(page, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'Signal resume' })).json() as Details;
  const root = `/api/v1/communities/${community.id}/voice`;
  await page.goto(`/communities/${community.id}/voice`); await page.getByRole('button', { name: 'Join voice', exact: true }).click(); await connected(page);
  await expect.poll(() => refreshed.length).toBeGreaterThan(0);
  expect((await page.request.get('/livekit/rtc/validate?' + new URLSearchParams({ access_token: refreshed }), { headers: { Origin: origin } })).status()).toBe(200);
  const before = await (await page.request.get(root)).json() as components['schemas']['VoiceStateDto'];
  await page.evaluate(() => (window as unknown as { admissionSockets: WebSocket[] }).admissionSockets.at(-1)!.close(4000, 'Synthetic transport interruption'));
  await expect.poll(() => signals, { timeout: 15_000 }).toBe(2); await connected(page);
  const after = await (await page.request.get(root)).json() as components['schemas']['VoiceStateDto'];
  expect(after.myLeaseId).toBe(before.myLeaseId); expect(after.generation).toBe(before.generation); expect(joins).toBe(1);
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
});
