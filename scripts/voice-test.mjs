/* global window, AudioContext */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reports = path.join(root, '.local', 'artifacts', 'voice');
const results = { startedAt: new Date().toISOString(), syntheticAudio: true, cases: [] };
let browser;
let probe;
let server;
let room;
let generation = 1;
let command;
let pending;
let lines;

async function until(callback, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await callback();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function connect(page, token) {
  return page.evaluate(async token => {
    if (window.voice) {
      await window.voice.room.disconnect();
      window.voice.oscillator?.stop();
      await window.voice.context?.close();
    }
    const sdk = await import('/sdk.mjs');
    const room = new sdk.Room({ adaptiveStream: false, dynacast: false });
    const state = { room, tracks: [], tokens: [], context: undefined, oscillator: undefined };
    window.voice = state;
    // Pinned-SDK test instrumentation only. Do not use this internal callback in UI.
    room.engine.on('tokenRefreshed', token => { state.tokens.push(token); });
    room.on(sdk.RoomEvent.TrackSubscribed, track => { state.tracks.push(track); track.attach(); });
    try {
      await room.connect('ws://127.0.0.1:7880', token);
      return true;
    } catch { await room.disconnect(); return false; }
  }, token);
}

async function publish(page) {
  return page.evaluate(async () => {
    const sdk = await import('/sdk.mjs');
    const context = new AudioContext();
    await context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.1;
    oscillator.frequency.value = 440;
    const destination = context.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    window.voice.context = context;
    window.voice.oscillator = oscillator;
    const track = new sdk.LocalAudioTrack(destination.stream.getAudioTracks()[0]);
    try {
      await window.voice.room.localParticipant.publishTrack(track, { source: sdk.Track.Source.Microphone });
      return true;
    } catch {
      oscillator.stop(); await context.close();
      window.voice.oscillator = undefined; window.voice.context = undefined;
      return false;
    }
  });
}

async function receive(page) {
  return until(() => page.evaluate(async () => {
    for (const track of window.voice.tracks) {
      if (track.kind !== 'audio') continue;
      const stats = await track.getReceiverStats();
      if ((stats?.bytesReceived ?? 0) > 0 && (stats?.totalAudioEnergy ?? 0) > 0)
        return { bytesReceived: stats.bytesReceived, packetsReceived: stats.packetsReceived, totalAudioEnergy: stats.totalAudioEnergy };
    }
    return null;
  }), 'No decoded nonzero synthetic audio received');
}

try {
  await mkdir(reports, { recursive: true });
  const sdk = await readFile(path.join(root, 'node_modules', 'livekit-client', 'dist', 'livekit-client.esm.mjs'));
  server = createServer((request, response) => {
    if (request.url === '/sdk.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(sdk); }
    else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic voice fixture</title><body>Automated synthetic audio fixture. No microphone access.</body></html>');
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(5274, '127.0.0.1', resolve);
  });
  probe = spawn(process.execPath, ['scripts/development.mjs', 'voice-probe'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let ready = false;
  lines = createInterface({ input: probe.stdout });
  lines.on('line', line => {
    if (line === 'READY') ready = true;
    else if (pending) {
      const { resolve, reject, timer } = pending;
      pending = undefined;
      clearTimeout(timer);
      try {
        const value = JSON.parse(line);
        if (value.error) reject(new Error(value.error)); else resolve(value);
      } catch { reject(new Error('Invalid voice probe response')); }
    }
  });
  const probeEnded = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.reject(new Error('Voice probe exited'));
    pending = undefined;
  };
  probe.on('exit', probeEnded);
  probe.stdin.on('error', probeEnded);
  // Probe errors are deliberately generic; never copy token or credential contents to logs.
  probe.stderr.on('data', () => {});
  await until(() => ready, 'Voice probe did not start');
  room = randomUUID();
  command = (Action, Identity = randomUUID(), CanSpeak = true) => new Promise((resolve, reject) => {
    assert.equal(pending, undefined, 'Probe commands must be sequential');
    const timer = setTimeout(() => { pending = undefined; reject(new Error('Voice probe timeout')); }, 5000);
    pending = { resolve, reject, timer };
    probe.stdin.write(JSON.stringify({ Action, Room: room, Generation: generation, Identity, CanSpeak }) + '\n');
  });
  await command('create');
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const sender = await context.newPage();
  const receiver = await mobileContext.newPage();
  results.viewports = ['1280x900', '390x844 Chromium emulation'];
  await sender.goto('http://127.0.0.1:5274');
  await receiver.goto('http://127.0.0.1:5274');
  const senderId = randomUUID();
  const receiverId = randomUUID();
  const senderGrant = await command('grant', senderId);
  const receiverGrant = await command('grant', receiverId);
  results.currentStep = 'connect-sender';
  assert.equal(await connect(sender, senderGrant.token), true);
  results.currentStep = 'connect-receiver';
  assert.equal(await connect(receiver, receiverGrant.token), true);
  results.currentStep = 'publish-audio';
  assert.equal(await publish(sender), true);
  results.currentStep = 'receive-audio';
  const audio = await receive(receiver);
  const participants = await command('participants');
  assert.equal(participants.length, 2);
  assert.equal(participants.find(p => p.identity === senderId.replaceAll('-', '')).audioTracks, 1);
  results.cases.push({ name: 'two-client-synthetic-audio', passed: true, audio });
  console.log('PASS: two clients received decoded nonzero synthetic audio');

  // Obtain a server-refreshed token before any permission restriction.
  results.currentStep = 'refresh-original-grant';
  await command('refresh', senderId);
  results.currentStep = 'observe-refreshed-token';
  const refreshed = await until(() => sender.evaluate(() => window.voice.tokens.at(-1)), 'No refreshed token observed');
  const refreshedClaims = JSON.parse(Buffer.from(refreshed.split('.')[1], 'base64url').toString());
  results.refreshedTokenRemainingSeconds = refreshedClaims.exp - Math.floor(Date.now() / 1000);
  await command('remove', senderId);
  results.currentStep = 'original-grant-replay';
  await until(() => sender.evaluate(() => window.voice.room.state === 'disconnected'), 'Kick did not disconnect sender');
  assert.equal(await connect(sender, senderGrant.token), true);
  assert.equal(await publish(sender), true);
  results.cases.push({ name: 'original-token-replays-after-kick', passed: true, bypassObserved: true });
  console.log('OBSERVED: original grant can rejoin and publish after removal');

  await command('restrict', senderId);
  results.currentStep = 'refreshed-grant-replay';
  await until(() => sender.evaluate(() => window.voice.room.localParticipant.permissions?.canPublish === false), 'Publish restriction did not reach sender');
  await sender.evaluate(() => window.voice.room.disconnect());
  assert.equal(await connect(sender, refreshed), true);
  assert.equal(await publish(sender), true);
  results.cases.push({ name: 'refreshed-token-replays-after-speaking-restriction', passed: true, bypassObserved: true });
  console.log('OBSERVED: earlier refreshed grant restores publication after speaking restriction');

  const deleteStarted = performance.now();
  results.currentStep = 'room-generation-transition';
  await command('delete');
  await until(() => receiver.evaluate(() => window.voice.room.state === 'disconnected'), 'Old room receiver did not disconnect');
  await until(() => sender.evaluate(() => window.voice.room.state === 'disconnected'), 'Old room sender did not disconnect');
  const deleteToObservedDisconnectMs = performance.now() - deleteStarted;
  generation = 2;
  await command('create');
  const currentGrant = await command('grant', receiverId);
  assert.equal(await connect(receiver, currentGrant.token), true);
  assert.equal(await connect(sender, refreshed), true, 'Old token may recreate the retired room');
  assert.equal(await publish(sender), true);
  const currentParticipants = await command('participants');
  assert.deepEqual(currentParticipants.map(p => p.identity), [receiverId.replaceAll('-', '')]);
  assert.equal(await receiver.evaluate(() => window.voice.room.remoteParticipants.size), 0);
  results.cases.push({ name: 'generation-separates-old-grant-from-current-room', passed: true, deleteToObservedDisconnectMs, retiredRoomRecreated: true });
  console.log('PASS: old grant recreates retired room but cannot enter the current generation');

  const listenOnly = await command('grant', senderId, false);
  await sender.evaluate(() => window.voice.room.disconnect());
  assert.equal(await connect(sender, listenOnly.token), true);
  assert.equal(await sender.evaluate(() => window.voice.room.localParticipant.permissions.canPublish), false);
  results.cases.push({ name: 'listen-only-grant-denies-publication', passed: true });
  console.log('PASS: fresh listen-only grant denies publication');

  results.currentStep = 'grant-expiry-versus-refreshed-token';
  // Expiry is checked against real wall time, not altered browser clocks.
  const originalExpiry = new Date(senderGrant.expiresAt).getTime();
  await until(() => Date.now() > originalExpiry + 2000, 'Original grant did not reach expiry', 65000);
  // The pinned SFU verifier allows one minute of clock skew. Capture that
  // admission window instead of assuming exp alone is a revocation deadline.
  assert.equal(await connect(sender, senderGrant.token), true);
  results.cases.push({ name: 'original-token-admitted-within-post-expiry-leeway', passed: true,
    originalExpiry: senderGrant.expiresAt, observedAt: new Date().toISOString() });
  console.log('OBSERVED: original grant still admits after exp within SFU clock-skew tolerance');
  await sender.evaluate(() => window.voice.room.disconnect());
  await until(() => Date.now() > originalExpiry + 62000, 'Original grant did not exceed validation tolerance', 65000);
  assert.equal(await connect(sender, senderGrant.token), false);
  assert.equal(await connect(sender, refreshed), true);
  assert.equal(await publish(sender), true);
  results.cases.push({ name: 'expired-original-denied-but-refreshed-token-still-replays', passed: true,
    originalExpiry: senderGrant.expiresAt, observedAt: new Date().toISOString() });
  console.log('PASS: original denied beyond leeway; refreshed grant still permits retired-room publication');
  results.completedAt = new Date().toISOString();
  delete results.currentStep;
} catch (error) {
  // Keep generic diagnostics: SDK exceptions can embed URLs containing grants.
  console.error(`${error instanceof assert.AssertionError ? 'Voice assertion' : 'Voice experiment'} failed at ${results.currentStep ?? 'setup/audio'}; inspect case progress.`);
  if (error instanceof assert.AssertionError && typeof error.actual === 'boolean') console.error(`Expected ${error.expected}, observed ${error.actual}`);
  results.failed = true;
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (command && room) {
    for (const value of [1, 2]) {
      generation = value;
      try { await command('delete'); } catch { /* Only synthetic room cleanup; do not delete unrelated rooms. */ }
    }
  }
  probe?.stdin.end();
  lines?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(reports, `run-${Date.now()}.json`), JSON.stringify(results, null, 2) + '\n');
}
