import { DisconnectReason, LocalVideoTrack, ParticipantEvent, Room, RoomEvent, Track } from 'livekit-client';
import type { LocalAudioTrack, LocalTrack, Participant, RemoteAudioTrack, RemoteVideoTrack } from 'livekit-client';
import { AudioActivity } from './AudioActivity';
import { microphoneFailure } from './microphoneFailure';
import { qualityPublishOptions, savedMediaQuality, screenProfiles, validQuality, videoConstraints } from './mediaQuality';
import type { MediaQuality, QualitySource, ScreenQuality } from './mediaQuality';
import { ConnectionCounter, emptyConnectionStats } from './connectionStats';
import type { ConnectionStats } from './connectionStats';
import { PttMicrophone } from './PttMicrophone';
import { endVoice, getVoice, heartbeatVoice, joinVoice } from '../../api/voice';
import type { VoiceState } from '../../api/voice';
import { ApiError } from '../../api/http';

export type VoiceSnapshot = {
  community: string | null; identity: string | null; name: string; status: string; error: string | null;
  muted: boolean; deafened: boolean; input: string; output: string; canSpeak: boolean;
  devices: MediaDeviceInfo[]; participants: VoiceState['participants']; speakers: string[]; changingAudio: boolean;
  playbackBlocked: boolean; startingPlayback: boolean; volume: number;
  noiseSuppression: boolean; noiseSuppressionSupported: boolean; noiseSuppressionApplied: boolean | null;
  changingNoiseSuppression: boolean; noiseSuppressionError: string | null;
  canShareScreen: boolean; canUseCamera: boolean; camera: boolean; sharing: boolean; changingMedia: boolean;
  cameraDevice: string; mediaError: string | null; videos: VoiceVideo[];
  quality: MediaQuality; changingQuality: QualitySource | null; qualityError: string | null;
  receiving: 'all' | 'screen' | 'none'; connection: ConnectionStats; receivingError: string | null;
  participantAudio: Record<string, { volume: number; muted: boolean }>;
  pushToTalk: boolean; pttHeld: boolean; pttKey: 'KeyV' | 'KeyB' | 'ControlRight';
};
export type VoiceVideo = { id: string; identity: string; local: boolean; source: 'camera' | 'screen'; track: LocalVideoTrack | RemoteVideoTrack | undefined; receiving: boolean };
function savedReceiving(): VoiceSnapshot['receiving'] {
  try { const value = localStorage.getItem('dosvyazi-receive-video'); return value === 'screen' || value === 'none' ? value : 'all'; }
  catch { return 'all'; }
}
function savedPtt() {
  try { const key = localStorage.getItem('dosvyazi-ptt-key'); return { pushToTalk: localStorage.getItem('dosvyazi-push-to-talk') === 'true', pttKey: key === 'KeyB' || key === 'ControlRight' ? key : 'KeyV' } as Pick<VoiceSnapshot, 'pushToTalk' | 'pttKey'>; }
  catch { return { pushToTalk: false, pttKey: 'KeyV' } as const; }
}
function savedVolume() {
  try { const stored = localStorage.getItem('dosvyazi-output-volume'); const n = stored === null ? 100 : Number(stored); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 100; }
  catch { return 100; }
}
function savedNoiseSuppression() {
  try { return localStorage.getItem('dosvyazi-noise-suppression') !== 'false'; }
  catch { return true; }
}
const microphoneIsLive = (track: LocalAudioTrack) => track.mediaStreamTrack.readyState === 'live';
const initial = (): VoiceSnapshot => ({ community: null, identity: null, name: '', status: 'Disconnected', error: null,
  muted: true, deafened: false, input: 'default', output: 'default', canSpeak: true, devices: [], participants: [], speakers: [], changingAudio: false, playbackBlocked: false, startingPlayback: false, volume: savedVolume(),
  noiseSuppression: savedNoiseSuppression(), noiseSuppressionSupported: navigator.mediaDevices?.getSupportedConstraints?.().noiseSuppression === true,
  noiseSuppressionApplied: null, changingNoiseSuppression: false, noiseSuppressionError: null,
  canShareScreen: false, canUseCamera: false, camera: false, sharing: false, changingMedia: false, cameraDevice: 'default', mediaError: null, videos: [],
  quality: savedMediaQuality(), changingQuality: null, qualityError: null,
  receiving: savedReceiving(), connection: emptyConnectionStats(), receivingError: null, participantAudio: {}, ...savedPtt(), pttHeld: false });

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
  private mutedBeforeDeafen = true;
  private audio = new Map<RemoteAudioTrack, HTMLMediaElement>();
  private audioOwners = new Map<RemoteAudioTrack, string>();
  private ptt: PttMicrophone | undefined;
  private pttIntent = 0;
  private pttOpening = false;
  private pttKeyboardHeld = false;
  private speakerSubscriptions = new Map<Participant, () => void>();
  private activity: AudioActivity | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disconnecting: Promise<void> = Promise.resolve();
  private mediaEpoch = 0;
  private noiseEpoch = 0;
  private noiseCapture = new Set<MediaStreamTrack>();
  private capture = new Set<LocalTrack>();
  private qualityCapture = new Set<LocalTrack>();
  private blockedVideo = new Set<string>();
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private statsPending: Room | undefined;
  private statsStarted = 0;
  private counter = new ConnectionCounter();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.value;
  private update(next: Partial<VoiceSnapshot>) { this.value = { ...this.value, ...next }; this.listeners.forEach(listener => listener()); }

  attach(user: string | undefined) {
    if (this.user !== user) { this.epoch++; this.disconnect(); this.lease = undefined; this.generation = undefined; this.value = initial(); this.user = user; this.update({}); }
    this.timer ??= setInterval(() => { void this.poll(); }, 2000);
    window.addEventListener('offline', this.offline);
    window.addEventListener('online', this.online);
    navigator.mediaDevices?.addEventListener('devicechange', this.deviceChange);
    window.addEventListener('keydown', this.pttDown); window.addEventListener('keyup', this.pttUp);
    window.addEventListener('blur', this.releasePtt); document.addEventListener('visibilitychange', this.pttVisibility);
  }
  detach() {
    clearInterval(this.timer); this.timer = undefined;
    window.removeEventListener('offline', this.offline); window.removeEventListener('online', this.online);
    navigator.mediaDevices?.removeEventListener('devicechange', this.deviceChange);
    window.removeEventListener('keydown', this.pttDown); window.removeEventListener('keyup', this.pttUp);
    window.removeEventListener('blur', this.releasePtt); document.removeEventListener('visibilitychange', this.pttVisibility);
    this.epoch++; this.disconnect();
  }
  private offline = () => { if (this.value.community) { this.disconnect(); this.update({ status: 'Offline', speakers: [] }); } };
  private online = () => { if (this.value.community) { this.update({ status: 'Reconnecting' }); void this.poll(); } };
  private deviceChange = () => { void this.devices(); };
  private disconnect() {
    const old = this.room; this.room = undefined;
    this.pttIntent++; this.ptt?.dispose(); this.ptt = undefined; this.pttOpening = false; this.pttKeyboardHeld = false;
    clearInterval(this.statsTimer); this.statsTimer = undefined; this.blockedVideo.clear();
    this.update({ connection: emptyConnectionStats(), receivingError: null, participantAudio: {}, pttHeld: false });
    for (const track of this.qualityCapture) track.stop(); this.qualityCapture.clear();
    this.noiseEpoch++;
    for (const track of this.noiseCapture) track.stop(); this.noiseCapture.clear();
    this.stopMedia(old);
    this.activity?.dispose(); this.activity = undefined;
    this.update({ changingAudio: false, speakers: [], playbackBlocked: false, startingPlayback: false,
      changingNoiseSuppression: false, noiseSuppressionApplied: null, noiseSuppressionError: null, changingQuality: null, qualityError: null });
    for (const [participant, listener] of this.speakerSubscriptions) participant.off(ParticipantEvent.IsSpeakingChanged, listener);
    this.speakerSubscriptions.clear();
    for (const element of this.audio.values()) element.remove(); this.audio.clear(); this.audioOwners.clear();
    if (old) { old.removeAllListeners(); this.disconnecting = old.disconnect().catch(() => {}); }
  }
  private moderated() {
    this.epoch++; this.disconnect(); this.lease = undefined; this.generation = undefined;
    this.request = crypto.randomUUID();
    this.update({ ...initial(), error: 'A moderator disconnected you from voice. Select Join voice when you are ready to return.' });
  }
  private observeSpeakers(room: Room, participant: Participant) {
    if (this.speakerSubscriptions.has(participant)) return;
    const sync = () => this.syncSpeakers(room);
    participant.on(ParticipantEvent.IsSpeakingChanged, sync);
    this.speakerSubscriptions.set(participant, sync);
  }
  private syncSpeakers(room: Room) {
    if (this.room !== room) return;
    const participants = [room.localParticipant, ...room.remoteParticipants.values()];
    const active = (p: Participant) => {
      const track = p.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      return (track ? this.activity?.speaking(track) : undefined) ?? p.isSpeaking;
    };
    const speakers = participants.filter(p => active(p) && p.isMicrophoneEnabled &&
      (p !== room.localParticipant || (!this.value.muted && !this.value.deafened))).map(p => p.identity);
    if (speakers.length !== this.value.speakers.length || speakers.some(id => !this.value.speakers.includes(id))) this.update({ speakers });
  }
  private denied(error: unknown) { return error instanceof ApiError && [401, 403, 404].includes(error.status); }
  private fail(error: unknown) {
    if (this.denied(error)) {
      this.epoch++; this.disconnect(); this.lease = undefined;
      this.generation = undefined; this.request = crypto.randomUUID();
      this.update({ ...initial(), error: 'Voice access ended. Sign in or check your community membership.' });
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
      this.update({ identity: grant.identity, canSpeak: grant.canSpeak, canShareScreen: grant.canShareScreen, canUseCamera: grant.canUseCamera, ...(grant.canSpeak ? {} : { muted: true }) });
      this.disconnect();
      await this.disconnecting;
      if (epoch !== this.epoch) return;
      const room = new Room({ adaptiveStream: true, dynacast: true }); this.room = room;
      this.activity = new AudioActivity(() => this.syncSpeakers(room));
      this.observeSpeakers(room, room.localParticipant);
      room.on(RoomEvent.ParticipantConnected, participant => { if (this.room === room) { this.observeSpeakers(room, participant); this.syncSpeakers(room); } });
      room.on(RoomEvent.ParticipantDisconnected, participant => {
        const listener = this.speakerSubscriptions.get(participant);
        if (listener) participant.off(ParticipantEvent.IsSpeakingChanged, listener);
        this.speakerSubscriptions.delete(participant);
        for (const source of [Track.Source.Camera, Track.Source.ScreenShare]) this.blockedVideo.delete(`${participant.identity}:${source}`);
        const levels = { ...this.value.participantAudio }; delete levels[participant.identity]; this.update({ participantAudio: levels });
        this.syncSpeakers(room); this.syncMedia(room);
      });
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (this.room !== room) return;
        if (track.kind === Track.Kind.Video) { this.syncMedia(room); return; }
        if (track.kind !== Track.Kind.Audio) return;
        const audioTrack = track as RemoteAudioTrack;
        const element = audioTrack.attach();
        this.audio.set(audioTrack, element); this.audioOwners.set(audioTrack, participant.identity); this.applyPlayback();
        element.hidden = true; document.body.append(element);
        if (publication.source === Track.Source.Microphone) this.activity?.observe(audioTrack);
      });
      room.on(RoomEvent.TrackUnsubscribed, track => { const audioTrack = track as RemoteAudioTrack; const element = this.audio.get(audioTrack); element?.remove(); this.audio.delete(audioTrack); this.audioOwners.delete(audioTrack); this.activity?.remove(audioTrack); this.syncSpeakers(room); this.syncMedia(room); });
      room.on(RoomEvent.TrackPublished, () => { this.applyReceiving(room); this.syncMedia(room); });
      room.on(RoomEvent.TrackUnpublished, () => this.syncMedia(room));
      room.on(RoomEvent.TrackSubscriptionFailed, () => { if (this.room === room) this.update({ receivingError: 'A media subscription failed. Retry receiving or reconnect if it persists.' }); });
      room.on(RoomEvent.LocalTrackPublished, publication => { if (this.room === room && publication.source === Track.Source.Microphone && publication.track?.kind === Track.Kind.Audio) this.activity?.observe(publication.track as LocalAudioTrack); this.syncMedia(room); });
      room.on(RoomEvent.LocalTrackUnpublished, publication => { if (publication.track?.kind === Track.Kind.Audio) this.activity?.remove(publication.track as LocalAudioTrack); this.syncSpeakers(room); this.syncMedia(room); });
      const interrupt = () => { if (this.room === room) { this.releasePtt(); this.stopMedia(room); this.update({ status: 'Reconnecting', speakers: [] }); } };
      room.on(RoomEvent.Reconnecting, interrupt);
      room.on(RoomEvent.SignalReconnecting, interrupt);
      room.on(RoomEvent.Reconnected, () => { if (this.room === room) { this.update({ status: 'Connected' }); this.applyReceiving(room); this.syncMedia(room); this.syncSpeakers(room); void this.poll(); } });
      room.on(RoomEvent.Disconnected, reason => {
        if (this.room !== room) return;
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) this.moderated();
        else if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
          this.moderated(); this.update({ error: 'This voice session was opened on another device. Select Join voice to return here.' });
        }
        else { this.releasePtt(); this.stopMedia(room); this.update({ status: 'Reconnecting', speakers: [] }); }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, () => this.syncSpeakers(room));
      room.on(RoomEvent.TrackMuted, () => { this.syncSpeakers(room); this.syncMedia(room); });
      room.on(RoomEvent.TrackUnmuted, () => { this.syncSpeakers(room); this.syncMedia(room); });
      room.on(RoomEvent.AudioPlaybackStatusChanged, playing => { if (this.room === room) this.update({ playbackBlocked: !playing }); });
      await room.connect(grant.url, grant.token, { autoSubscribe: false });
      if (epoch !== this.epoch || this.room !== room) { await room.disconnect(); return; }
      this.update({ status: 'Connected' });
      this.applyReceiving(room);
      this.counter = new ConnectionCounter();
      this.statsStarted = Date.now();
      this.statsTimer = setInterval(() => { void this.sampleConnection(room); }, 2000);
      void this.sampleConnection(room);
      for (const participant of room.remoteParticipants.values()) if (!this.speakerSubscriptions.has(participant)) this.observeSpeakers(room, participant);
      this.syncSpeakers(room);
      this.syncMedia(room);
      await room.startAudio().catch(() => { if (this.room === room) this.update({ playbackBlocked: true }); });
      if (this.room !== room) return;
      this.update({ playbackBlocked: !room.canPlaybackAudio });
      if (!this.value.muted && !this.value.deafened) await this.microphone(false);
      await this.devices();
      this.lastHeartbeat = 0;
    } catch (error) {
      if (epoch === this.epoch) {
        if (error instanceof ApiError && error.code === 'voice_join_stale') {
          this.disconnect(); this.request = crypto.randomUUID();
          this.update({ status: 'Join failed', error: 'Your previous voice session ended. Select Reconnect voice to start a new session.' });
        }
        else if (error instanceof ApiError && error.status === 409) { this.request = crypto.randomUUID(); this.update({ status: 'Access updating', error: error.message }); }
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
    if (!community || this.polling || this.busy || !navigator.onLine || ['Leave not confirmed', 'Join failed'].includes(this.value.status)) return;
    this.polling = true; const epoch = this.epoch;
    try {
      const state = await getVoice(community, undefined, this.lease);
      if (epoch !== this.epoch) return;
      if (state.disconnectedByModerator) { this.moderated(); return; }
      this.update({ participants: state.participants });
      if (!state.canConnect) { this.disconnect(); this.update({ ...initial(), error: 'Voice access was revoked.' }); this.lease = undefined; return; }
      if (!state.canSpeak && !this.value.muted) await this.microphone(true);
      if (epoch !== this.epoch) return;
      if ((!state.canShareScreen && this.value.sharing) || (!state.canUseCamera && this.value.camera)) this.stopMedia(this.room);
      this.update({ canSpeak: state.canSpeak, canShareScreen: state.canShareScreen, canUseCamera: state.canUseCamera });
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
  volume(percent: number) {
    if (!Number.isFinite(percent)) return;
    const volume = Math.max(0, Math.min(100, percent));
    this.update({ volume }); this.applyPlayback();
    try { localStorage.setItem('dosvyazi-output-volume', String(volume)); } catch { /* Volume remains usable without browser storage. */ }
  }
  inputPreference(id: string) { if (!this.room) this.update({ input: id }); }
  participantLevel(identity: string, volume: number, muted: boolean) {
    if (!this.room?.remoteParticipants.has(identity) || !Number.isFinite(volume)) return;
    this.update({ participantAudio: { ...this.value.participantAudio, [identity]: { volume: Math.max(0, Math.min(100, volume)), muted } } });
    this.applyPlayback();
  }
  private applyPlayback() {
    for (const [track, element] of this.audio) {
      const level = this.value.participantAudio[this.audioOwners.get(track) ?? ''];
      element.volume = this.value.volume * (level?.volume ?? 100) / 10000;
      element.muted = this.value.deafened || level?.muted === true;
    }
  }
  private pttDown = (event: KeyboardEvent) => {
    if (!this.room || this.value.status !== 'Connected' || !this.value.pushToTalk || this.value.pttHeld || event.repeat || event.code !== this.value.pttKey || document.hidden ||
      (event.code !== 'ControlRight' && (event.ctrlKey || event.altKey || event.metaKey)) ||
      (event.target instanceof Element && event.target.closest('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])'))) return;
    this.pttKeyboardHeld = true; event.preventDefault(); void this.holdToTalk(true);
  };
  private pttUp = (event: KeyboardEvent) => { if (event.code === this.value.pttKey && this.pttKeyboardHeld) this.releasePtt(); };
  private pttVisibility = () => { if (document.hidden) this.releasePtt(); };
  private releasePtt = () => {
    this.pttKeyboardHeld = false;
    if (!this.room && !this.ptt && !this.value.pttHeld) return;
    if (!this.value.pushToTalk && !this.ptt) return;
    this.pttIntent++; this.ptt?.close();
    const track = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (track) { track.mediaStreamTrack.enabled = false; void track.mute().catch(() => {}); }
    for (const pending of this.qualityCapture) if (pending.source === Track.Source.Microphone) { pending.mediaStreamTrack.enabled = false; void (pending as LocalAudioTrack).mute().catch(() => {}); }
    this.update({ pttHeld: false, muted: true });
    if (this.room) this.syncSpeakers(this.room);
  };
  pttKey(value: VoiceSnapshot['pttKey']) {
    if (!['KeyV', 'KeyB', 'ControlRight'].includes(value)) return;
    this.releasePtt(); this.update({ pttKey: value });
    try { localStorage.setItem('dosvyazi-ptt-key', value); } catch { /* Session setting remains usable. */ }
  }
  async pushToTalk(enabled: boolean) {
    if (!this.room || this.value.changingAudio || this.value.changingQuality || this.value.changingNoiseSuppression || enabled === this.value.pushToTalk) return;
    if (enabled && typeof AudioContext === 'undefined') return;
    const room = this.room;
    this.update({ pushToTalk: enabled, changingAudio: true, muted: true, pttHeld: false, noiseSuppressionApplied: null });
    this.pttIntent++; this.ptt?.dispose(); this.ptt = undefined;
    try {
      const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      if (track) { track.stop(); await room.localParticipant.unpublishTrack(track); }
      if (this.room === room) try { localStorage.setItem('dosvyazi-push-to-talk', String(enabled)); } catch { /* Session setting remains usable. */ }
    } catch { if (this.room === room) this.update({ error: 'Microphone mode could not change. Leave voice and try again.' }); }
    finally { if (this.room === room) this.update({ changingAudio: false }); }
  }
  async holdToTalk(held: boolean) {
    if (!held) { this.releasePtt(); return; }
    const room = this.room;
    if (!this.value.pushToTalk || this.value.pttHeld || this.pttOpening || !room || room.state !== 'connected' || !this.value.canSpeak || this.value.deafened || this.value.changingAudio || this.value.changingQuality || this.value.changingNoiseSuppression || document.hidden) return;
    const intent = ++this.pttIntent;
    const current = () => this.room === room && room.state === 'connected' && this.value.pushToTalk && this.value.pttHeld && this.pttIntent === intent && this.value.canSpeak && !this.value.deafened;
    this.update({ pttHeld: true, changingAudio: true, error: null }); this.pttOpening = true;
    let gate = this.ptt;
    try {
      if (!gate?.live) {
        gate?.dispose(); gate = new PttMicrophone(() => {
          if (this.room !== room || this.ptt !== gate) return;
          this.releasePtt(); gate?.dispose(); this.ptt = undefined;
          if (gate) void room.localParticipant.unpublishTrack(gate.publicationTrack).catch(() => {});
          this.update({ error: 'Microphone stopped. Hold the button again to retry.' });
        }); this.ptt = gate;
        await gate.capture({ echoCancellation: true, autoGainControl: true,
          ...(this.value.input === 'default' ? {} : { deviceId: { exact: this.value.input } }),
          ...(this.value.noiseSuppressionSupported ? { noiseSuppression: this.value.noiseSuppression } : {}) });
        if (!current()) { gate.dispose(); if (this.ptt === gate) this.ptt = undefined; return; }
        await gate.track.mute();
        if (!current()) { gate.dispose(); if (this.ptt === gate) this.ptt = undefined; return; }
        await room.localParticipant.publishTrack(gate.publicationTrack, { ...qualityPublishOptions('audio', this.value.quality), source: Track.Source.Microphone });
      }
      if (!current()) {
        gate.close(); await gate.track.mute();
        if (this.room !== room) { gate.dispose(); await room.localParticipant.unpublishTrack(gate.publicationTrack).catch(() => {}); }
        return;
      }
      await gate.resume();
      if (!current()) { gate.close(); return; }
      await gate.track.unmute();
      if (!current()) { gate.close(); gate.track.mediaStreamTrack.enabled = false; await gate.track.mute(); return; }
      if (room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack !== gate.track || !gate.open())
        throw new DOMException('Microphone publication is unavailable', 'NotReadableError');
      this.update({ muted: false, noiseSuppressionApplied: gate.settings?.noiseSuppression ?? null }); this.syncSpeakers(room); void this.devices();
    } catch (error) {
      gate?.dispose(); if (this.ptt === gate) this.ptt = undefined;
      if (gate) await room.localParticipant.unpublishTrack(gate.publicationTrack).catch(() => {});
      if (this.room === room) this.update({ pttHeld: false, muted: true, error: microphoneFailure(error) });
    } finally { if (this.room === room) { this.pttOpening = false; this.update({ changingAudio: false }); } }
  }
  async quality(source: QualitySource, level: ScreenQuality) {
    if (!validQuality(source, level) || this.value.changingQuality || this.value.changingMedia || this.value.changingAudio || this.value.changingNoiseSuppression) return;
    if (this.value.quality[source] === level && !this.value.qualityError) return;
    const next: MediaQuality = { ...this.value.quality, [source]: level };
    const save = () => {
      this.update({ quality: next, qualityError: null });
      try { localStorage.setItem(`dosvyazi-quality-${source}`, level); } catch { /* Keep the current session usable without storage. */ }
    };
    const room = this.room;
    const trackSource = source === 'audio' ? Track.Source.Microphone : source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
    const publication = room?.localParticipant.getTrackPublication(trackSource);
    const track = publication?.track;
    // Choosing an inactive source's profile must never start capture or request permission.
    if (!track || track.mediaStreamTrack.readyState !== 'live') { save(); return; }
    if (!room || room.state !== 'connected') return;
    const epoch = this.mediaEpoch;
    const current = () => this.room === room && this.mediaEpoch === epoch && room.state === 'connected' && track.mediaStreamTrack.readyState === 'live' &&
      (source === 'audio' ? this.value.canSpeak : source === 'camera' ? this.value.canUseCamera : this.value.canShareScreen);
    const constraints = track.mediaStreamTrack.getConstraints();
    const contentHint = track.mediaStreamTrack.contentHint;
    this.qualityCapture.add(track);
    this.update({ changingQuality: source, qualityError: null, ...(source === 'audio' ? { changingAudio: true } : { changingMedia: true }) });
    let unpublished = false;
    const discard = async () => { track.stop(); if (this.ptt?.track === track) { this.ptt.dispose(); this.ptt = undefined; this.releasePtt(); } this.capture.delete(track); await room.localParticipant.unpublishTrack(track).catch(() => {}); };
    try {
      if (source !== 'audio') {
        if (source === 'screen') track.mediaStreamTrack.contentHint = next.screen === 'ultra' ? 'motion' : 'detail';
        await track.mediaStreamTrack.applyConstraints({ ...constraints, ...videoConstraints(source, next) });
        if (!current()) { await discard(); return; }
        const applied = track.mediaStreamTrack.getSettings();
        const limits = videoConstraints(source, next);
        // Some browsers resolve applyConstraints without honoring a requested cap.
        for (const key of ['width', 'height', 'frameRate'] as const) {
          const maximum = (limits[key] as ConstrainDoubleRange).max;
          if (maximum !== undefined && applied[key] !== undefined && applied[key]! > maximum + 0.5) throw new Error('Unconfirmed media constraint');
        }
      }
      // Public SDK operations, one source only. Keep the capture alive; never republish all tracks.
      await room.localParticipant.unpublishTrack(track, false); unpublished = true;
      if (!current()) { await discard(); return; }
      if (source === 'audio' && (this.value.muted || this.value.deafened)) await (track as LocalAudioTrack).mute();
      if (!current()) { await discard(); return; }
      await room.localParticipant.publishTrack(track, { ...publication.options, ...qualityPublishOptions(source, next), source: trackSource });
      if (!current()) { await discard(); return; }
      save(); this.syncMedia(room); this.syncSpeakers(room);
    } catch {
      if (!current()) { await discard(); return; }
      try {
        // A rejected publish can leave its CID pending in the SFU. Do not retry
        // that same capture automatically: stop only this source for explicit recovery.
        if (unpublished) throw new Error('Publication must be restarted explicitly');
        if (source !== 'audio') {
          track.mediaStreamTrack.contentHint = contentHint;
          await track.mediaStreamTrack.applyConstraints(constraints);
        }
        if (!current()) { await discard(); return; }
        this.update({ qualityError: 'Quality could not be changed. The previous setting is kept. Try again.' });
      } catch {
        await discard();
        if (this.room === room) this.update({ ...(source === 'audio' ? { muted: true } : {}), qualityError: 'Quality could not be restored. Enable the affected source to try again.' });
      }
      if (this.room === room) { this.syncMedia(room); this.syncSpeakers(room); }
    } finally {
      this.qualityCapture.delete(track);
      if (this.room === room && this.mediaEpoch === epoch) this.update({ changingQuality: null, ...(source === 'audio' ? { changingAudio: false } : { changingMedia: false }) });
    }
  }
  async noiseSuppression(enabled: boolean) {
    if (this.value.pushToTalk) return;
    const room = this.room;
    if (!room || room.state !== 'connected' || !this.value.canSpeak || !this.value.noiseSuppressionSupported || this.value.changingAudio || this.value.changingNoiseSuppression) return;
    this.update({ noiseSuppression: enabled, noiseSuppressionError: null });
    try { localStorage.setItem('dosvyazi-noise-suppression', String(enabled)); } catch { /* Keep this session's preference when storage is unavailable. */ }
    await this.applyNoiseSuppression(room);
  }
  private async applyNoiseSuppression(room: Room) {
    if (this.room !== room) return;
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (!this.value.noiseSuppressionSupported || !track || !microphoneIsLive(track)) {
      this.update({ noiseSuppressionApplied: null, noiseSuppressionError: null }); return;
    }
    const epoch = ++this.noiseEpoch;
    const current = () => this.room === room && epoch === this.noiseEpoch && room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack === track;
    this.update({ changingNoiseSuppression: true });
    try {
      // Preserve device/echo/gain constraints because native applyConstraints replaces them.
      if (track.mediaStreamTrack.getSettings().noiseSuppression !== this.value.noiseSuppression)
        await track.applyConstraints({ ...track.mediaStreamTrack.getConstraints(), noiseSuppression: this.value.noiseSuppression });
      if (!current()) return;
      if (track.mediaStreamTrack.getSettings().noiseSuppression !== this.value.noiseSuppression) {
        // Some browsers accept processing constraints but only apply them on new capture.
        // Never reacquire a muted/deafened microphone just to change this preference.
        if (this.value.muted || this.value.deafened || !this.value.canSpeak || room.state !== 'connected') {
          this.update({ noiseSuppressionApplied: null, noiseSuppressionError: null }); return;
        }
        const source = track.mediaStreamTrack;
        // Chromium can share the old source's processing with a parallel capture.
        // Release only this voice track before requesting the new processing mode.
        source.stop();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          ...source.getConstraints(), noiseSuppression: this.value.noiseSuppression,
        }, video: false });
        const replacement = stream.getAudioTracks()[0];
        for (const other of stream.getTracks()) if (other !== replacement) other.stop();
        if (!replacement) throw new Error('No microphone track');
        replacement.enabled = false; this.noiseCapture.add(replacement);
        try {
          if (!current() || track.mediaStreamTrack !== source) return;
          if (this.value.muted || this.value.deafened || !this.value.canSpeak || room.state !== 'connected') {
            this.update({ noiseSuppressionApplied: null, noiseSuppressionError: null }); return;
          }
          if (replacement.getSettings().noiseSuppression === this.value.noiseSuppression) {
            await track.replaceTrack(replacement, { userProvidedTrack: false });
            if (!current() || room.state !== 'connected' || !this.value.canSpeak) { replacement.stop(); return; }
            // Respect mute/deafen changes made while replaceTrack was pending.
            replacement.enabled = !track.isMuted && !this.value.muted && !this.value.deafened;
            this.activity?.remove(track); this.activity?.observe(track); void this.activity?.resume();
          } else throw new Error('Unconfirmed microphone processing');
        } finally {
          this.noiseCapture.delete(replacement);
          if (track.mediaStreamTrack !== replacement) replacement.stop();
        }
      }
      if (!current()) return;
      const applied = track.mediaStreamTrack.getSettings().noiseSuppression;
      this.update({ noiseSuppressionApplied: applied ?? null,
        noiseSuppressionError: applied === this.value.noiseSuppression ? null : 'Your browser could not confirm the requested noise suppression setting.' });
    } catch {
      if (current()) {
        if (!microphoneIsLive(track)) {
          await track.mute();
          if (current()) this.update({ muted: true, noiseSuppressionApplied: null,
            noiseSuppressionError: 'Microphone refresh failed. Your microphone is muted. Enable it to try again.' });
        } else this.update({ noiseSuppressionApplied: track.mediaStreamTrack.getSettings().noiseSuppression ?? null,
          noiseSuppressionError: 'Noise suppression could not be changed. Your microphone keeps its previous setting.' });
      }
    } finally { if (this.room === room && epoch === this.noiseEpoch) this.update({ changingNoiseSuppression: false }); }
  }
  async microphone(muted: boolean) {
    if (this.value.pushToTalk) { if (muted) this.releasePtt(); else return; }
    const room = this.room;
    if (room && muted && this.value.changingQuality === 'audio') { await this.muteQualityCapture(room); return; }
    if (!room || room.state !== 'connected' || this.value.changingAudio) return;
    if (!muted && !this.value.canSpeak) { this.update({ muted: true, error: 'SpeakVoice is denied. You can listen.' }); return; }
    this.update({ changingAudio: true });
    try { await this.setMicrophone(room, muted); }
    finally { if (this.room === room) this.update({ changingAudio: false }); }
  }
  private async muteQualityCapture(room: Room) {
    this.update({ muted: true });
    for (const track of this.qualityCapture) if (track.source === Track.Source.Microphone) {
      track.mediaStreamTrack.enabled = false;
      await (track as LocalAudioTrack).mute().catch(() => {});
    }
    if (this.room === room) this.syncSpeakers(room);
  }
  private async setMicrophone(room: Room, muted: boolean) {
    try {
      const previous = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (!muted && previous && !previous.isMuted && !microphoneIsLive(previous))
        await room.localParticipant.unpublishTrack(previous.mediaStreamTrack);
      if (this.room !== room || room.state !== 'connected') return false;
      const publication = await room.localParticipant.setMicrophoneEnabled(!muted, {
        ...(this.value.input === 'default' ? {} : { deviceId: this.value.input }),
        ...(this.value.noiseSuppressionSupported ? { noiseSuppression: this.value.noiseSuppression } : {}),
      }, qualityPublishOptions('audio', this.value.quality));
      if (!muted && (!publication?.audioTrack || !microphoneIsLive(publication.audioTrack)))
        throw new DOMException('Microphone capture did not provide a live track', 'NotReadableError');
      if (this.room === room) await this.activity?.resume();
      if (this.room === room) { this.update({ muted, error: null }); if (!muted) void this.applyNoiseSuppression(room); this.syncSpeakers(room); await this.devices(); }
      return true;
    } catch (error) {
      if (this.room === room) {
        // Do not retain an ended, unmuted SDK publication after a failed capture:
        // a later enable can otherwise unmute that publication without reacquiring.
        const failed = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
        if (failed) { failed.stop(); await room.localParticipant.unpublishTrack(failed).catch(() => {}); }
        if (this.room === room) this.update({ muted: true, error: microphoneFailure(error) });
      }
      return false;
    }
  }
  async deafen(deafened: boolean) {
    if (deafened) this.releasePtt();
    const room = this.room;
    if (room && deafened && this.value.pushToTalk && this.value.changingAudio) {
      this.mutedBeforeDeafen = true; this.update({ deafened: true }); this.applyPlayback();
      await room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack?.mute().catch(() => {});
      return;
    }
    if (room && deafened && this.value.changingQuality === 'audio' && !this.value.deafened) {
      this.mutedBeforeDeafen = this.value.muted;
      for (const element of this.audio.values()) element.muted = true;
      this.update({ deafened: true });
      await this.muteQualityCapture(room);
      if (this.room === room) await room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack?.mute().catch(() => {});
      return;
    }
    if (!room || room.state !== 'connected' || this.value.changingAudio || this.value.deafened === deafened) return;
    this.update({ changingAudio: true });
    try {
      if (deafened) {
        this.mutedBeforeDeafen = this.value.muted;
        if (!await this.setMicrophone(room, true)) return;
      }
      if (this.room !== room) return;
      this.update({ deafened });
      const screenAudio = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack;
      if (screenAudio) { if (deafened) await screenAudio.mute(); else await screenAudio.unmute(); }
      this.applyPlayback();
      if (!deafened && !this.mutedBeforeDeafen && this.value.canSpeak && !this.value.pushToTalk) await this.setMicrophone(room, false);
      this.syncSpeakers(room);
    } finally { if (this.room === room) this.update({ changingAudio: false }); }
  }
  async device(kind: 'audioinput' | 'audiooutput', id: string) {
    if (kind === 'audioinput' && this.value.pushToTalk) return;
    const room = this.room;
    if (!room || this.value.changingQuality) return;
    try {
      if (!await room.switchActiveDevice(kind, id)) throw new Error();
      if (this.room === room) this.update(kind === 'audioinput' ? { input: id, error: null } : { output: id, error: null });
      if (kind === 'audioinput' && this.room === room) await this.applyNoiseSuppression(room);
    } catch (error) {
      if (this.room !== room) return;
      const failed = kind === 'audioinput' ? room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack : undefined;
      if (failed && !microphoneIsLive(failed)) {
        await room.localParticipant.unpublishTrack(failed.mediaStreamTrack).catch(() => {});
        if (this.room === room) this.update({ muted: true });
      }
      if (this.room === room) this.update({ error: kind === 'audioinput' ? microphoneFailure(error) : 'The selected audio device is unavailable in this browser. Use the default device or try another.' });
    }
  }
  async playback() {
    const room = this.room;
    if (!room || this.value.startingPlayback) return;
    this.update({ startingPlayback: true });
    try {
      await room.startAudio();
      if (this.room === room) await this.activity?.resume();
      if (this.room === room) this.update({ playbackBlocked: !room.canPlaybackAudio, error: room.canPlaybackAudio ? null : 'Playback could not start. Check your browser audio settings.' });
    }
    catch { if (this.room === room) this.update({ error: 'Playback could not start. Check your browser audio settings.' }); }
    finally { if (this.room === room) this.update({ startingPlayback: false }); }
  }

  receiving(value: VoiceSnapshot['receiving']) {
    if (!['all', 'screen', 'none'].includes(value)) return;
    this.update({ receiving: value, receivingError: null });
    try { localStorage.setItem('dosvyazi-receive-video', value); } catch { /* Session preference still applies. */ }
    if (this.room) { this.applyReceiving(this.room, true); this.syncMedia(this.room); }
  }
  receiveVideo(id: string, receive: boolean) {
    const room = this.room;
    const participant = room && [...room.remoteParticipants.values()].find(p => p.videoTrackPublications.has(id));
    const publication = participant?.videoTrackPublications.get(id);
    if (!room || !participant || !publication) return;
    const key = `${participant.identity}:${publication.source}`;
    if (receive) this.blockedVideo.delete(key); else this.blockedVideo.add(key);
    this.update({ receivingError: null }); this.applyReceiving(room); this.syncMedia(room);
  }
  private wantsVideo(source: Track.Source, identity: string) {
    return !this.blockedVideo.has(`${identity}:${source}`) && this.value.receiving !== 'none' && (this.value.receiving === 'all' || source === Track.Source.ScreenShare);
  }
  private applyReceiving(room: Room, retry = false) {
    if (this.room !== room) return;
    for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) {
      const wanted = publication.kind !== Track.Kind.Video || this.wantsVideo(publication.source, participant.identity);
      if (publication.isDesired !== wanted || (retry && wanted && !publication.isSubscribed)) publication.setSubscribed(wanted);
    }
  }
  private async sampleConnection(room: Room) {
    if (this.room !== room) return;
    if (this.statsPending === room || room.state !== 'connected') {
      if (room.state !== 'connected' || Date.now() - (this.value.connection.sampledAt ?? this.statsStarted) > 6000)
        this.update({ connection: { ...this.value.connection, status: 'unavailable', sendBps: null, receiveBps: null, rttMs: null, jitterMs: null, lossPercent: null, videos: [] } });
      return;
    }
    this.statsPending = room;
    try {
      const tracks = [room.localParticipant, ...room.remoteParticipants.values()].flatMap(p => [...p.trackPublications.values()].flatMap(publication => publication.track ? [publication.track] : []));
      const reports = await Promise.all(tracks.map(track => track.getRTCStatsReport()));
      if (this.room !== room || room.state !== 'connected') return;
      if (tracks.length && reports.every(report => !report)) throw new Error('Media counters unsupported');
      this.update({ connection: this.counter.sample(reports.filter((report): report is RTCStatsReport => !!report)) });
    } catch {
      if (this.room === room) this.update({ connection: { ...this.value.connection, status: 'unavailable', sendBps: null, receiveBps: null, rttMs: null, jitterMs: null, lossPercent: null, videos: [] } });
    } finally { if (this.statsPending === room) this.statsPending = undefined; }
  }
  connectionReport() {
    return { version: 1, scope: 'This browser voice connection; RTP payload only', quality: { ...this.value.quality }, receiving: this.value.receiving,
      connection: { ...this.value.connection }, excludes: ['HTTP/signaling', 'transport overhead', 'other applications', 'host CPU/RAM/disk'],
      reset: 'Counters reset on a new voice connection. Export contains no names, room IDs, tokens, addresses or raw WebRTC reports.' };
  }
  private syncMedia(room: Room) {
    if (this.room !== room) return;
    const videos: VoiceVideo[] = [];
    for (const participant of [room.localParticipant, ...room.remoteParticipants.values()]) {
      for (const publication of participant.videoTrackPublications.values()) {
        const track = publication.videoTrack;
        const local = participant === room.localParticipant;
        if ((local && (!track || track.mediaStreamTrack.readyState === 'ended')) || publication.isMuted || ![Track.Source.Camera, Track.Source.ScreenShare].includes(publication.source)) continue;
        videos.push({ id: publication.trackSid, identity: participant.identity, local: participant === room.localParticipant,
          source: publication.source === Track.Source.Camera ? 'camera' : 'screen', track, receiving: local || this.wantsVideo(publication.source, participant.identity) });
      }
    }
    const sharing = videos.some(video => video.local && video.source === 'screen');
    const clearAudioNotice = !sharing && this.value.sharing && this.value.mediaError === 'This source or browser did not provide screen audio. Your screen is still shared.';
    this.update({ videos, camera: videos.some(video => video.local && video.source === 'camera'), sharing, ...(clearAudioNotice ? { mediaError: null } : {}) });
  }

  // Stop physical tracks synchronously; pending picker results are rejected by the epoch guard.
  private stopMedia(room: Room | undefined) {
    this.mediaEpoch++;
    for (const track of this.capture) track.stop();
    this.capture.clear();
    if (room) for (const publication of room.localParticipant.trackPublications.values()) {
      if (![Track.Source.Camera, Track.Source.ScreenShare, Track.Source.ScreenShareAudio].includes(publication.source) || !publication.track) continue;
      publication.track.stop(); void room.localParticipant.unpublishTrack(publication.track).catch(() => {});
    }
    this.update({ camera: false, sharing: false, changingMedia: false, videos: [], mediaError: null, changingQuality: null });
  }

  cameraDevice(id: string) { if (!this.value.camera && !this.value.changingMedia) this.update({ cameraDevice: id }); }
  clearMediaError() { this.update({ mediaError: null }); }

  async media(source: 'camera' | 'screen', enabled: boolean, screenAudio = false) {
    const room = this.room;
    if (!room || room.state !== 'connected' || this.value.changingMedia) return;
    if (enabled && !(source === 'camera' ? this.value.canUseCamera : this.value.canShareScreen)) return;
    const epoch = this.mediaEpoch;
    this.update({ changingMedia: true, mediaError: null });
    const tracks: LocalTrack[] = [];
    const current = () => this.room === room && epoch === this.mediaEpoch && room.state === 'connected';
    try {
      if (!enabled) {
        for (const publication of [...room.localParticipant.trackPublications.values()]) {
          if (!publication.track || !(source === 'camera' ? publication.source === Track.Source.Camera : [Track.Source.ScreenShare, Track.Source.ScreenShareAudio].includes(publication.source))) continue;
          publication.track.stop(); this.capture.delete(publication.track);
          await room.localParticipant.unpublishTrack(publication.track);
        }
      } else {
        // Capture starts before the first await, preserving getDisplayMedia's user gesture.
        tracks.push(...await (source === 'screen' ? room.localParticipant.createScreenTracks({ audio: screenAudio,
          resolution: screenProfiles[this.value.quality.screen], contentHint: this.value.quality.screen === 'ultra' ? 'motion' : 'detail', selfBrowserSurface: 'exclude', systemAudio: screenAudio ? 'include' : 'exclude' })
          : navigator.mediaDevices.getUserMedia({ audio: false, video: { ...videoConstraints('camera', this.value.quality),
            ...(this.value.cameraDevice === 'default' ? {} : { deviceId: { exact: this.value.cameraDevice } }) } }).then(stream => stream.getVideoTracks().map(track => {
              // User-provided tracks prevent SDK reconnect/background recovery from acquiring a camera silently.
              const local = new LocalVideoTrack(track, undefined, true); local.source = Track.Source.Camera; return local;
            }))));
        if (!current()) { for (const track of tracks) track.stop(); return; }
        for (const track of tracks) this.capture.add(track);
        for (const track of tracks) {
          track.mediaStreamTrack.addEventListener('ended', () => {
            this.capture.delete(track);
            if (this.room === room) void room.localParticipant.unpublishTrack(track).then(() => this.syncMedia(room)).catch(() => {});
          }, { once: true });
          if (track.source === Track.Source.ScreenShareAudio && this.value.deafened) await (track as LocalAudioTrack).mute();
          if (!current()) { for (const acquired of tracks) acquired.stop(); return; }
          await room.localParticipant.publishTrack(track, { source: track.source,
            ...qualityPublishOptions(track.source === Track.Source.ScreenShareAudio ? 'audio' : source, track.source === Track.Source.ScreenShareAudio ? { ...this.value.quality, audio: 'standard' } : this.value.quality) });
          if (!current()) { for (const acquired of tracks) { acquired.stop(); this.capture.delete(acquired); } await room.localParticipant.unpublishTrack(track); return; }
        }
        if (screenAudio && source === 'screen' && !tracks.some(track => track.source === Track.Source.ScreenShareAudio)) {
          this.update({ mediaError: 'This source or browser did not provide screen audio. Your screen is still shared.' });
        }
      }
      if (current()) { this.syncMedia(room); await this.devices(); }
    } catch (error) {
      for (const track of tracks) { track.stop(); this.capture.delete(track); void room.localParticipant.unpublishTrack(track).catch(() => {}); }
      if (current()) {
        this.syncMedia(room);
        if (!(source === 'screen' && error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name))) {
          this.update({ mediaError: source === 'screen' ? 'Screen sharing could not start. Choose a source and try again.' : 'Camera unavailable. Allow camera access and check the selected device, then try again.' });
        }
      }
    } finally { if (current()) this.update({ changingMedia: false }); }
  }
}
