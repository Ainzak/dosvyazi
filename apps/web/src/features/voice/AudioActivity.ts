import { TrackEvent } from 'livekit-client';
import type { LocalAudioTrack, RemoteAudioTrack } from 'livekit-client';

type AudioTrack = LocalAudioTrack | RemoteAudioTrack;
type Meter = { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; lastSound: number; active: boolean; restart: () => void };

// This is an audio-activity indicator, not speech recognition. One context serves
// all received/published tracks and never routes microphone audio to a speaker.
export class AudioActivity {
  private context: AudioContext | undefined;
  private meters = new Map<AudioTrack, Meter>();
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private changed: () => void) {}

  observe(track: AudioTrack) {
    this.remove(track);
    try {
      this.context ??= new AudioContext();
      const source = this.context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      const analyser = this.context.createAnalyser(); analyser.fftSize = 512;
      source.connect(analyser);
      const restart = () => this.observe(track);
      track.on(TrackEvent.Restarted, restart);
      this.meters.set(track, { source, analyser, samples: new Float32Array(512), lastSound: 0, active: false, restart });
      void this.resume();
      this.timer ??= setInterval(() => this.sample(), 60);
    } catch { /* SDK speaker events remain the fallback when analysis is unavailable. */ }
  }

  private sample() {
    if (this.context?.state !== 'running') return;
    const now = performance.now();
    for (const [track, meter] of this.meters) {
      meter.analyser.getFloatTimeDomainData(meter.samples);
      const rms = Math.sqrt(meter.samples.reduce((sum, value) => sum + value * value, 0) / meter.samples.length);
      const available = !track.isMuted && track.mediaStreamTrack.readyState === 'live' && track.mediaStreamTrack.enabled;
      if (available && rms >= 0.01) meter.lastSound = now;
      meter.active = available && meter.lastSound > 0 && now - meter.lastSound < 300;
    }
    this.changed();
  }

  speaking(track: AudioTrack): boolean | undefined {
    return this.context?.state === 'running' ? this.meters.get(track)?.active : undefined;
  }
  async resume() { try { await this.context?.resume(); } catch { /* Browser gesture may be required. */ } }
  remove(track: AudioTrack) {
    const meter = this.meters.get(track);
    if (!meter) return;
    track.off(TrackEvent.Restarted, meter.restart);
    meter.source.disconnect(); meter.analyser.disconnect(); this.meters.delete(track);
  }
  dispose() {
    clearInterval(this.timer); this.timer = undefined;
    for (const track of this.meters.keys()) this.remove(track);
    const context = this.context; this.context = undefined;
    if (context) void context.close().catch(() => {});
  }
}
