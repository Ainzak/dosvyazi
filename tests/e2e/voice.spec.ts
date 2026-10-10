import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { VoiceJoin } from '../../apps/web/src/api/voice';
import type { components } from '../../apps/web/src/api/schema';

async function register(page: Page, name: string) {
  await page.goto('/register');
  await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`voice-browser-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic voice browser 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}.` })).toBeVisible();
}
async function create(page: Page) {
  await page.goto('/communities');
  await page.getByLabel('Community name', { exact: true }).fill('Voice browser crew');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Voice browser crew', exact: true })).toBeVisible();
}
async function receivedEnergy(page: Page) {
  return page.evaluate(async () => {
    const element = [...document.querySelectorAll('audio')].find(audio => audio.srcObject instanceof MediaStream);
    if (!element || !(element.srcObject instanceof MediaStream)) return 0;
    const context = new AudioContext();
    try {
      await context.resume();
      const source = context.createMediaStreamSource(element.srcObject);
      const analyser = context.createAnalyser(); source.connect(analyser);
      await new Promise(resolve => setTimeout(resolve, 150));
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      return samples.reduce((sum, value) => sum + value * value, 0);
    } finally { await context.close(); }
  });
}

test('Speak revocation rotates live audio, rejoins listen-only, and Connect/View denies remain scoped', async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  await register(page, 'Voice policy owner'); await create(page);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const root = `/api/v1${new URL(page.url()).pathname}`;
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] });
  try {
    const member = await context.newPage(); await register(member, 'Voice policy peer'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await page.getByRole('button', { name: 'Join voice', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
    const oldResponse = member.waitForResponse(response => response.url().endsWith('/voice/join') && response.request().method() === 'POST');
    await member.getByRole('button', { name: 'Join voice', exact: true }).click(); const old: VoiceJoin = await (await oldResponse).json();
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
    await member.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect.poll(() => receivedEnergy(page), { timeout: 15000 }).toBeGreaterThan(0.001);
    async function deny(bits: number) {
      const policy = await (await page.request.get(root + '/access')).json() as components['schemas']['AccessPolicy'];
      const everyone = policy.roles.find(role => role.name === 'everyone')!.id;
      policy.voiceRules = [{ resourceId: everyone, roleId: everyone, allow: 0, deny: bits }];
      expect((await page.request.put(root + '/access', { headers: { 'X-CSRF-TOKEN': csrf.requestToken }, data: { clientRequestId: crypto.randomUUID(), policy } })).status()).toBe(200);
    }
    const listenerResponse = member.waitForResponse(response => response.url().endsWith('/voice/join') && response.request().method() === 'POST' && response.status() === 200);
    await deny(4096); const listener: VoiceJoin = await (await listenerResponse).json();
    expect(listener.canSpeak).toBe(false); expect(BigInt(listener.generation)).toBeGreaterThan(BigInt(old.generation));
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Muted', { timeout: 20000 });
    await expect(member.getByRole('button', { name: 'Enable microphone', exact: true })).toBeDisabled();
    await expect.poll(() => receivedEnergy(page)).toBeLessThan(0.001);
    const replay = await context.newPage(); await replay.goto('/about');
    const observed = await replay.evaluate(async grant => {
      const sdkUrl = '/node_modules/.vite/deps/livekit-client.js'; const sdk = await import(sdkUrl); const room = new sdk.Room();
      try { await room.connect(grant.url, grant.token); await new Promise(resolve => setTimeout(resolve, 1000)); return room.remoteParticipants.size as number; }
      catch { return 0; } finally { await room.disconnect(); }
    }, old);
    expect(observed).toBe(0); await replay.close();
    await deny(2048 | 4096);
    await expect(member.getByRole('region', { name: 'Voice controls' })).toHaveCount(0, { timeout: 15000 });
    await expect(member.getByRole('button', { name: 'Join voice', exact: true })).toBeDisabled();
    await deny(1 | 2048 | 4096);
    await expect(member.getByRole('heading', { name: 'Voice unavailable.', exact: true })).toBeVisible();
    await member.getByRole('link', { name: 'general', exact: true }).click(); await expect(member.getByRole('heading', { name: '#general' })).toBeVisible();
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await member.screenshot({ path: info.outputPath('voice-private-text-accessible.png'), fullPage: true });
  } finally { await context.close(); }
});

test('members receive audio, keep voice through text navigation, mute/deafen and leave', async ({ page, browser }, info) => {
  test.setTimeout(65_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await register(page, 'Voice owner'); await create(page);
  await expect(page.getByText('No one is in voice yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] });
  try {
    const member = await context.newPage(); member.on('pageerror', error => errors.push(error.message));
    await register(member, 'Voice peer'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(code);
    await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await expect(member.getByRole('heading', { name: 'Voice browser crew', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Join voice', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Muted');
    await member.getByRole('button', { name: 'Join voice', exact: true }).click();
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Muted');
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
    await expect.poll(() => receivedEnergy(member), { timeout: 15_000 }).toBeGreaterThan(0.001);
    await expect(member.getByText('2 in voice', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'general', exact: true }).click();
    await expect(page.getByRole('heading', { name: '#general' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Microphone on');
    await expect.poll(() => receivedEnergy(member)).toBeGreaterThan(0.001);
    await member.getByRole('button', { name: 'Deafen', exact: true }).click();
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Deafened');
    expect(await member.locator('audio').evaluateAll(items => items.every(item => (item as HTMLMediaElement).muted))).toBe(true);
    await member.getByRole('button', { name: 'Undeafen', exact: true }).click();
    await expect(member.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await expect.poll(() => receivedEnergy(member)).toBeLessThan(0.001);
    await member.getByText('Audio devices', { exact: true }).click();
    expect(await member.getByLabel('Microphone device').isEnabled()).toBe(true);
    const input = await member.getByLabel('Microphone device').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).find(value => value !== 'default'));
    expect(input).toBeTruthy();
    await member.getByLabel('Microphone device').selectOption(input!);
    await expect(member.getByLabel('Microphone device')).toHaveValue(input!);
    await member.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await expect.poll(() => receivedEnergy(page)).toBeGreaterThan(0.001);
    await member.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    await context.setOffline(true);
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Offline');
    await context.setOffline(false);
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Muted', { timeout: 20_000 });
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await member.screenshot({ path: info.outputPath('voice-connected.png'), fullPage: true });
    await member.getByRole('button', { name: 'Leave voice', exact: true }).click();
    await expect(member.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
    await expect(member.locator('audio')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('ban ends the member voice and an interrupted check can recover', async ({ page, browser }) => {
  test.setTimeout(55_000);
  await register(page, 'Voice moderator'); await create(page);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize()!, permissions: ['microphone'] });
  try {
    const member = await context.newPage(); await register(member, 'Banned voice peer'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    await member.getByRole('button', { name: 'Join voice', exact: true }).click();
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Muted');
    await member.route('**/voice', route => route.abort('connectionfailed'));
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Voice access check interrupted.', { timeout: 10_000 });
    await member.unroute('**/voice');
    await page.reload(); await page.getByRole('button', { name: 'Ban Banned voice peer', exact: true }).click();
    await expect(member.getByRole('region', { name: 'Voice controls' })).toHaveCount(0, { timeout: 15_000 });
    await expect(member.locator('audio')).toHaveCount(0);
    await expect(member.getByText('Voice access ended. Sign in or check your community membership.')).toBeVisible();
  } finally { await context.close(); }
});

test('voice check loading and failure have a retry action', async ({ page }, info) => {
  await register(page, 'Voice states');
  let release: () => void = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/voice', async route => { await gate; await route.fulfill({ status: 503, json: { title: 'Voice control service is unavailable.' } }); });
  try {
    await create(page); await expect(page.getByText('Checking voice room…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join voice', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Retry voice check', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('voice-unavailable.png'), fullPage: true });
  await page.unroute('**/voice'); await page.getByRole('button', { name: 'Retry voice check', exact: true }).click();
  await expect(page.getByText('No one is in voice yet.')).toBeVisible();
});

test('microphone denial remains muted and account change clears voice', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await register(page, 'Denied microphone'); await create(page);
  await page.getByRole('button', { name: 'Join voice', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Muted');
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Microphone unavailable.');
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'My account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(0);
  await register(page, 'Next voice account');
  await expect(page.getByRole('region', { name: 'Voice controls' })).toHaveCount(0);
});

test('completed ban rotates current audio away from a replayed old grant', async ({ page, browser }) => {
  test.setTimeout(60_000);
  await register(page, 'Rotation owner'); await create(page);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const code = await page.getByLabel('Share this invitation code').inputValue();
  const community = new URL(page.url()).pathname.split('/')[2]!;
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', permissions: ['microphone'] });
  try {
    const member = await context.newPage(); await register(member, 'Replay peer'); await member.goto('/communities');
    await member.getByLabel('Invitation code', { exact: true }).fill(code); await member.getByRole('button', { name: 'Join community', exact: true }).click();
    const oldResponse = member.waitForResponse(response => response.url().endsWith('/voice/join') && response.request().method() === 'POST');
    await member.getByRole('button', { name: 'Join voice', exact: true }).click();
    const old: VoiceJoin = await (await oldResponse).json();
    await expect(member.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
    await page.getByRole('button', { name: 'Join voice', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected');
    await page.reload(); // Reauthorize after navigation/reload; the worker retains the lease.
    await page.getByRole('button', { name: 'Ban Replay peer', exact: true }).click();
    await expect.poll(async () => {
      const response = await page.request.get(`/api/v1/communities/${community}/voice`);
      const state: { status: string; generation: string } = await response.json();
      return state.status === 'Ready' && BigInt(state.generation) > BigInt(old.generation);
    }, { timeout: 15_000 }).toBe(true);
    await page.getByRole('button', { name: 'Join voice', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    const attacker = await context.newPage(); await attacker.goto('/about');
    const observed = await attacker.evaluate(async grant => {
      const sdkUrl = '/node_modules/.vite/deps/livekit-client.js';
      const sdk = await import(sdkUrl);
      const room = new sdk.Room();
      let joined = false;
      try {
        await room.connect(grant.url, grant.token); joined = true;
        await new Promise(resolve => setTimeout(resolve, 1200));
        return { joined, remoteCount: room.remoteParticipants.size as number };
      } catch { return { joined, remoteCount: 0 }; }
      finally { await room.disconnect(); }
    }, old);
    // Self-hosted admission may succeed in the retired generation; it must never
    // expose an authorized current-generation peer, even before cleanup kicks in.
    expect(observed.remoteCount).toBe(0);
    await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Microphone on');
    await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
  } finally { await context.close(); }
});

test('lost join response retries the same request and reconnects automatically', async ({ page }) => {
  test.setTimeout(35_000);
  await register(page, 'Retrying voice'); await create(page);
  const requests: string[] = []; let first = true;
  await page.route('**/voice/join', async route => {
    const body: { clientRequestId: string } = route.request().postDataJSON(); requests.push(body.clientRequestId);
    if (first) { first = false; await route.fetch(); await route.abort('connectionfailed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Join voice', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connection interrupted');
  await expect(page.getByRole('region', { name: 'Voice controls' })).toContainText('Connected · Muted', { timeout: 20_000 });
  expect(requests.length).toBeGreaterThanOrEqual(2); expect(new Set(requests).size).toBe(1);
  await expect(page.getByText('1 in voice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave voice', exact: true }).click();
});
