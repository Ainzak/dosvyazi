import { Room, RoomEvent, Track } from 'livekit-client';
import type { RemoteAudioTrack } from 'livekit-client';
import { endVoice, getVoice, heartbeatVoice, joinVoice } from '../../api/voice';
import type { VoiceState } from '../../api/voice';
import { ApiError } from '../../api/http';

export type VoiceSnapshot = {
  community: string | null; name: string; status: string; error: string | null;
  muted: boolean; deafened: boolean; input: string; output: string;
  devices: MediaDeviceInfo[]; participants: VoiceState['participants']; speakers: string[]; changingAudio: boolean;
};
const initial = (): VoiceSnapshot => ({ community: null, name: '', status: 'Disconnected', error: null,
  muted: true, deafened: false, input: 'default', output: 'default', devices: [], participants: [], speakers: [], changingAudio: false });

export class VoiceClient {
  private value = initial();
  private listeners = new Set<() => void>();
  private room: Room | undefined;
  private lease: string | undefined;
  private generation: string | undefined;
  private request = crypto.randomUUID();
  private epoch = 0;
  private user: string | undefined;
  private busy = false;
  private polling = false;
  private lastHeartbeat = 0;
  private lastAttempt = 0;
  private audio = new Map<RemoteAudioTrack, HTMLMediaElement>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private disconnecting: Promise<void> = Promise.resolve();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.value;
  private update(next: Partial<VoiceSnapshot>) { this.value = { ...this.value, ...next }; this.listeners.forEach(listener => listener()); }

  attach(user: string | undefined) {
    if (this.user !== user) { this.epoch++; this.disconnect(); this.lease = undefined; this.generation = undefined; this.value = initial(); this.user = user; this.update({}); }
    this.timer ??= setInterval(() => { void this.poll(); }, 2000);
    window.addEventListener('offline', this.offline);
    window.addEventListener('online', this.online);
    navigator.mediaDevices?.addEventListener('devicechange', this.deviceChange);
  }
  detach() {
    clearInterval(this.timer); this.timer = undefined;
    window.removeEventListener('offline', this.offline); window.removeEventListener('online', this.online);
    navigator.mediaDevices?.removeEventListener('devicechange', this.deviceChange);
    this.epoch++; this.disconnect();
  }
  private offline = () => { if (this.value.community) { this.disconnect(); this.update({ status: 'Offline', speakers: [] }); } };
  private online = () => { if (this.value.community) { this.update({ status: 'Reconnecting' }); void this.poll(); } };
  private deviceChange = () => { void this.devices(); };
  private disconnect() {
    const old = this.room; this.room = undefined;
    this.update({ changingAudio: false });
    for (const element of this.audio.values()) element.remove(); this.audio.clear();
    if (old) { old.removeAllListeners(); this.disconnecting = old.disconnect().catch(() => {}); }
  }
  private denied(error: unknown) { return error instanceof ApiError && [401, 403, 404].includes(error.status); }
  private fail(error: unknown) {
    if (this.denied(error)) {
      this.epoch++; this.disconnect(); this.lease = undefined;
      this.update({ community: null, participants: [], speakers: [], status: 'Disconnected', error: 'Voice access ended. Sign in or check your community membership.' });
    } else this.update({ error: error instanceof ApiError ? error.message : 'Voice connection failed. Check your network and try again.', status: 'Connection interrupted' });
  }

  async join(community: string, name: string, fresh = false) {
    if (this.busy || !this.user) return;
    if (this.value.community && this.value.community !== community) { this.update({ error: 'Leave the current voice room before joining another.' }); return; }
    this.busy = true;
    const epoch = this.epoch;
    this.lastAttempt = Date.now();
    if (fresh) this.request = crypto.randomUUID();
    this.update({ community, name, status: 'Joining', error: null });
    try {
      const grant = await joinVoice(community, this.request);
      if (epoch !== this.epoch) return;
      this.lease = grant.leaseId; this.generation = grant.generation;
      this.disconnect();
      await this.disconnecting;
      if (epoch !== this.epoch) return;
      const room = new Room(); this.room = room;
      room.on(RoomEvent.TrackSubscribed, track => {
        if (this.room !== room || track.kind !== Track.Kind.Audio) return;
        const audioTrack = track as RemoteAudioTrack;
        const element = audioTrack.attach(); element.muted = this.value.deafened;
        element.hidden = true; document.body.append(element); this.audio.set(audioTrack, element);
      });
      room.on(RoomEvent.TrackUnsubscribed, track => { const element = this.audio.get(track as RemoteAudioTrack); element?.remove(); this.audio.delete(track as RemoteAudioTrack); });
      room.on(RoomEvent.Reconnecting, () => this.update({ status: 'Reconnecting', speakers: [] }));
      room.on(RoomEvent.Reconnected, () => { this.update({ status: 'Connected' }); void this.poll(); });
      room.on(RoomEvent.Disconnected, () => { if (this.room === room) this.update({ status: 'Reconnecting', speakers: [] }); });
      room.on(RoomEvent.ActiveSpeakersChanged, participants => this.update({ speakers: participants.map(item => item.identity) }));
      await room.connect(grant.url, grant.token);
      if (epoch !== this.epoch || this.room !== room) { await room.disconnect(); return; }
      this.update({ status: 'Connected' });
      await room.startAudio().catch(() => this.update({ error: 'Playback needs a click. Select Enable playback.' }));
      if (!this.value.muted && !this.value.deafened) await this.microphone(false);
      await this.devices();
      this.lastHeartbeat = 0;
    } catch (error) {
      if (epoch === this.epoch) {
        if (error instanceof ApiError && error.status === 409) { this.request = crypto.randomUUID(); this.update({ status: 'Access updating', error: error.message }); }
        else this.fail(error);
      }
    } finally { this.busy = false; }
  }

  async leave() {
    if (this.busy || !this.value.community) return;
    const community = this.value.community; const lease = this.lease;
    this.busy = true; const epoch = ++this.epoch; this.disconnect(); this.update({ status: 'Leaving', participants: [], speakers: [] });
    try {
      if (lease) await endVoice(community, lease);
      if (epoch !== this.epoch) return;
      this.lease = undefined; this.generation = undefined; this.request = crypto.randomUUID(); this.update(initial());
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (this.denied(error)) { this.lease = undefined; this.update(initial()); }
      else this.update({ status: 'Leave not confirmed', error: 'You are disconnected locally. Retry leaving to close the server session.' });
    } finally { this.busy = false; }
  }

  private async poll() {
    const community = this.value.community;
    if (!community || this.polling || this.busy || !navigator.onLine || this.value.status === 'Leave not confirmed') return;
    this.polling = true; const epoch = this.epoch;
    try {
      const state = await getVoice(community);
      if (epoch !== this.epoch) return;
      this.update({ participants: state.participants });
      if (state.status === 'Pending') {
        this.disconnect(); this.update({ status: 'Access updating', error: state.controlUnavailable ? 'Voice service is unavailable. Access changes remain pending.' : null, speakers: [] });
      } else if (state.controlUnavailable) {
        this.update({ error: 'Voice service check is unavailable. Try again shortly.' });
      } else if (state.generation !== this.generation || state.myLeaseId !== this.lease || ['Reconnecting', 'Access updating', 'Connection interrupted'].includes(this.value.status)) {
        const changed = (this.generation !== undefined && state.generation !== this.generation) ||
          (this.lease !== undefined && state.myLeaseId !== this.lease);
        if (Date.now() - this.lastAttempt >= 10000) await this.join(community, this.value.name, changed);
      } else if (this.lease && Date.now() - this.lastHeartbeat >= 10000) {
        await heartbeatVoice(community, this.lease); this.lastHeartbeat = Date.now();
      }
      if (this.value.error === 'Voice access check interrupted. Retrying…' || this.value.error === 'Voice service check is unavailable. Try again shortly.') this.update({ error: null });
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof ApiError && error.status === 409) { this.disconnect(); this.update({ status: 'Reconnecting', speakers: [] }); }
      else if (this.denied(error)) this.fail(error);
      else this.update({ error: 'Voice access check interrupted. Retrying…' });
    } finally { this.polling = false; }
  }

  async devices() {
    const epoch = this.epoch;
    try { const devices = await Room.getLocalDevices(undefined, false); if (epoch === this.epoch) this.update({ devices }); }
    catch { if (epoch === this.epoch) this.update({ error: 'Audio devices could not be listed.' }); }
  }
  async microphone(muted: boolean) {
    const room = this.room;
    if (!room || room.state !== 'connected' || this.value.changingAudio) return;
    this.update({ changingAudio: true });
    try {
      await room.localParticipant.setMicrophoneEnabled(!muted, this.value.input === 'default' ? undefined : { deviceId: this.value.input });
      if (this.room === room) { this.update({ muted, error: null }); await this.devices(); }
    } catch {
      if (this.room === room) {
        for (const publication of room.localParticipant.audioTrackPublications.values()) publication.track?.stop();
        this.update({ muted: true, error: 'Microphone unavailable. Allow microphone access and check the selected device, then try again.' });
      }
    } finally { if (this.room === room) this.update({ changingAudio: false }); }
  }
  async deafen(deafened: boolean) {
    const epoch = this.epoch;
    if (deafened) await this.microphone(true);
    if (epoch !== this.epoch) return;
    this.update({ deafened });
    for (const element of this.audio.values()) element.muted = deafened;
  }
  async device(kind: 'audioinput' | 'audiooutput', id: string) {
    const room = this.room;
    if (!room) return;
    try {
      if (!await room.switchActiveDevice(kind, id)) throw new Error();
      if (this.room === room) this.update(kind === 'audioinput' ? { input: id, error: null } : { output: id, error: null });
    } catch { if (this.room === room) this.update({ error: 'The selected audio device is unavailable in this browser. Use the default device or try another.' }); }
  }
  async playback() {
    const room = this.room;
    try { await room?.startAudio(); if (this.room === room) this.update({ error: null }); }
    catch { if (this.room === room) this.update({ error: 'Playback could not start. Check your browser audio settings.' }); }
  }
}
