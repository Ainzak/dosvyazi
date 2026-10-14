import { DisconnectReason, LocalVideoTrack, ParticipantEvent, Room, RoomEvent, Track } from 'livekit-client';
import type { LocalAudioTrack, LocalTrack, Participant, RemoteAudioTrack, RemoteVideoTrack } from 'livekit-client';
import { AudioActivity } from './AudioActivity';
import { endVoice, getVoice, heartbeatVoice, joinVoice } from '../../api/voice';
import type { VoiceState } from '../../api/voice';
import { ApiError } from '../../api/http';

export type VoiceSnapshot = {
  community: string | null; name: string; status: string; error: string | null;
  muted: boolean; deafened: boolean; input: string; output: string; canSpeak: boolean;
  devices: MediaDeviceInfo[]; participants: VoiceState['participants']; speakers: string[]; changingAudio: boolean;
  playbackBlocked: boolean; startingPlayback: boolean; volume: number;
  canShareScreen: boolean; canUseCamera: boolean; camera: boolean; sharing: boolean; changingMedia: boolean;
  cameraDevice: string; mediaError: string | null; videos: VoiceVideo[];
};
export type VoiceVideo = { id: string; identity: string; local: boolean; source: 'camera' | 'screen'; track: LocalVideoTrack | RemoteVideoTrack };
function savedVolume() {
  try { const stored = localStorage.getItem('dosvyazi-output-volume'); const n = stored === null ? 100 : Number(stored); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 100; }
  catch { return 100; }
}
const initial = (): VoiceSnapshot => ({ community: null, name: '', status: 'Disconnected', error: null,
  muted: true, deafened: false, input: 'default', output: 'default', canSpeak: true, devices: [], participants: [], speakers: [], changingAudio: false, playbackBlocked: false, startingPlayback: false, volume: savedVolume(),
  canShareScreen: false, canUseCamera: false, camera: false, sharing: false, changingMedia: false, cameraDevice: 'default', mediaError: null, videos: [] });

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
  private speakerSubscriptions = new Map<Participant, () => void>();
  private activity: AudioActivity | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disconnecting: Promise<void> = Promise.resolve();
  private mediaEpoch = 0;
  private capture = new Set<LocalTrack>();
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
    this.stopMedia(old);
    this.activity?.dispose(); this.activity = undefined;
    this.update({ changingAudio: false, speakers: [], playbackBlocked: false, startingPlayback: false });
    for (const [participant, listener] of this.speakerSubscriptions) participant.off(ParticipantEvent.IsSpeakingChanged, listener);
    this.speakerSubscriptions.clear();
    for (const element of this.audio.values()) element.remove(); this.audio.clear();
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
      this.update({ canSpeak: grant.canSpeak, canShareScreen: grant.canShareScreen, canUseCamera: grant.canUseCamera, ...(grant.canSpeak ? {} : { muted: true }) });
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
        this.speakerSubscriptions.delete(participant); this.syncSpeakers(room); this.syncMedia(room);
      });
      room.on(RoomEvent.TrackSubscribed, (track, publication) => {
        if (this.room !== room) return;
        if (track.kind === Track.Kind.Video) { this.syncMedia(room); return; }
        if (track.kind !== Track.Kind.Audio) return;
        const audioTrack = track as RemoteAudioTrack;
        const element = audioTrack.attach(); element.muted = this.value.deafened; element.volume = this.value.volume / 100;
        element.hidden = true; document.body.append(element); this.audio.set(audioTrack, element);
        if (publication.source === Track.Source.Microphone) this.activity?.observe(audioTrack);
      });
      room.on(RoomEvent.TrackUnsubscribed, track => { const audioTrack = track as RemoteAudioTrack; const element = this.audio.get(audioTrack); element?.remove(); this.audio.delete(audioTrack); this.activity?.remove(audioTrack); this.syncSpeakers(room); this.syncMedia(room); });
      room.on(RoomEvent.TrackUnpublished, () => this.syncMedia(room));
      room.on(RoomEvent.LocalTrackPublished, publication => { if (this.room === room && publication.source === Track.Source.Microphone && publication.track?.kind === Track.Kind.Audio) this.activity?.observe(publication.track as LocalAudioTrack); this.syncMedia(room); });
      room.on(RoomEvent.LocalTrackUnpublished, publication => { if (publication.track?.kind === Track.Kind.Audio) this.activity?.remove(publication.track as LocalAudioTrack); this.syncSpeakers(room); this.syncMedia(room); });
      const interrupt = () => { if (this.room === room) { this.stopMedia(room); this.update({ status: 'Reconnecting', speakers: [] }); } };
      room.on(RoomEvent.Reconnecting, interrupt);
      room.on(RoomEvent.SignalReconnecting, interrupt);
      room.on(RoomEvent.Reconnected, () => { if (this.room === room) { this.update({ status: 'Connected' }); this.syncSpeakers(room); void this.poll(); } });
      room.on(RoomEvent.Disconnected, reason => {
        if (this.room !== room) return;
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) this.moderated();
        else if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
          this.moderated(); this.update({ error: 'This voice session was opened on another device. Select Join voice to return here.' });
        }
        else { this.stopMedia(room); this.update({ status: 'Reconnecting', speakers: [] }); }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, () => this.syncSpeakers(room));
      room.on(RoomEvent.TrackMuted, () => { this.syncSpeakers(room); this.syncMedia(room); });
      room.on(RoomEvent.TrackUnmuted, () => { this.syncSpeakers(room); this.syncMedia(room); });
      room.on(RoomEvent.AudioPlaybackStatusChanged, playing => { if (this.room === room) this.update({ playbackBlocked: !playing }); });
      await room.connect(grant.url, grant.token);
      if (epoch !== this.epoch || this.room !== room) { await room.disconnect(); return; }
      this.update({ status: 'Connected' });
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
    for (const element of this.audio.values()) element.volume = volume / 100;
    this.update({ volume });
    try { localStorage.setItem('dosvyazi-output-volume', String(volume)); } catch { /* Volume remains usable without browser storage. */ }
  }
  async microphone(muted: boolean) {
    const room = this.room;
    if (!room || room.state !== 'connected' || this.value.changingAudio) return;
    if (!muted && !this.value.canSpeak) { this.update({ muted: true, error: 'SpeakVoice is denied. You can listen.' }); return; }
    this.update({ changingAudio: true });
    try { await this.setMicrophone(room, muted); }
    finally { if (this.room === room) this.update({ changingAudio: false }); }
  }
  private async setMicrophone(room: Room, muted: boolean) {
    try {
      await room.localParticipant.setMicrophoneEnabled(!muted, this.value.input === 'default' ? undefined : { deviceId: this.value.input });
      if (this.room === room) await this.activity?.resume();
      if (this.room === room) { this.update({ muted, error: null }); this.syncSpeakers(room); await this.devices(); }
      return true;
    } catch {
      if (this.room === room) {
        room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.stop();
        this.update({ muted: true, error: 'Microphone unavailable. Allow microphone access and check the selected device, then try again.' });
      }
      return false;
    }
  }
  async deafen(deafened: boolean) {
    const room = this.room;
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
      for (const element of this.audio.values()) element.muted = deafened;
      if (!deafened && !this.mutedBeforeDeafen && this.value.canSpeak) await this.setMicrophone(room, false);
      this.syncSpeakers(room);
    } finally { if (this.room === room) this.update({ changingAudio: false }); }
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

  private syncMedia(room: Room) {
    if (this.room !== room) return;
    const videos: VoiceVideo[] = [];
    for (const participant of [room.localParticipant, ...room.remoteParticipants.values()]) {
      for (const publication of participant.videoTrackPublications.values()) {
        const track = publication.videoTrack;
        if (!track || track.mediaStreamTrack.readyState === 'ended' || publication.isMuted || ![Track.Source.Camera, Track.Source.ScreenShare].includes(publication.source)) continue;
        videos.push({ id: publication.trackSid, identity: participant.identity, local: participant === room.localParticipant,
          source: publication.source === Track.Source.Camera ? 'camera' : 'screen', track });
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
    this.update({ camera: false, sharing: false, changingMedia: false, videos: [], mediaError: null });
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
          resolution: { width: 1280, height: 720, frameRate: 15 }, contentHint: 'detail', selfBrowserSurface: 'exclude', systemAudio: screenAudio ? 'include' : 'exclude' })
          : navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 }, frameRate: { ideal: 15, max: 15 },
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
          await room.localParticipant.publishTrack(track, { source: track.source, videoCodec: 'vp8', simulcast: false,
            videoEncoding: { maxBitrate: 450_000, maxFramerate: 15 }, screenShareEncoding: { maxBitrate: 1_200_000, maxFramerate: 15 } });
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
