import { LocalAudioTrack, Track } from 'livekit-client';
import type { LocalTrack } from 'livekit-client';
import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import { createEnhancedNoise } from './enhancedNoise';

// A zero-gain boundary protects release/focus loss even while SDK mute/unmute
// or publication is awaiting negotiation. This graph never plays locally.
export class GatedMicrophone {
  readonly track: LocalAudioTrack;
  private context = new AudioContext({ sampleRate: 48000 });
  private gate = this.context.createGain();
  private input: MediaStream | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private disposed = false;
  private controller = new AbortController();
  private processor: RnnoiseWorkletNode | undefined;
  constructor(private ended: () => void) {
    const destination = this.context.createMediaStreamDestination(); destination.channelCount = 1;
    this.gate.gain.value = 0; this.gate.connect(destination);
    this.track = new LocalAudioTrack(destination.stream.getAudioTracks()[0]!, undefined, true);
    this.track.source = Track.Source.Microphone;
    void this.context.resume().catch(() => {});
  }
  async capture(constraints: MediaTrackConstraints, enhanced = false) {
    if (enhanced) {
      this.processor = await createEnhancedNoise(this.context, this.controller.signal, () => { this.close(); if (!this.disposed) this.ended(); });
      if (this.disposed) { this.processor.destroy(); this.processor.disconnect(); return false; }
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
    if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.input = stream;
    const input = stream.getAudioTracks()[0];
    if (!input || input.readyState !== 'live') throw new DOMException('No live microphone', 'NotReadableError');
    input.addEventListener('ended', () => { this.close(); if (!this.disposed) this.ended(); }, { once: true });
    this.source = this.context.createMediaStreamSource(stream);
    if (this.processor) { this.source.connect(this.processor); this.processor.connect(this.gate); }
    else this.source.connect(this.gate);
    await this.context.resume();
    return !this.disposed;
  }
  get settings() { return this.input?.getAudioTracks()[0]?.getSettings(); }
  // SDK2.22's optional processor type is invariant under exactOptionalPropertyTypes;
  // this is the same public LocalAudioTrack object at the SDK publication boundary.
  get publicationTrack() { return this.track as unknown as LocalTrack; }
  get live() { return !this.disposed && this.input?.getAudioTracks()[0]?.readyState === 'live' && this.track.mediaStreamTrack.readyState === 'live'; }
  async resume() { await this.context.resume(); }
  open() { if (!this.live) return false; this.gate.gain.setValueAtTime(1, this.context.currentTime); return true; }
  close() {
    if (this.disposed) return;
    this.gate.gain.setValueAtTime(0, this.context.currentTime);
    if (this.processor) void this.context.suspend().catch(() => {});
  }
  dispose() {
    if (this.disposed) return;
    this.close(); this.disposed = true; this.controller.abort(); this.input?.getTracks().forEach(track => track.stop()); this.track.stop();
    this.processor?.destroy(); this.processor?.disconnect(); this.processor?.port.close(); this.processor = undefined;
    this.source?.disconnect(); this.gate.disconnect(); void this.context.close().catch(() => {});
  }
}

export { GatedMicrophone as PttMicrophone };
