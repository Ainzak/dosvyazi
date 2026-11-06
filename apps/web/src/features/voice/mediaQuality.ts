import { AudioPresets } from 'livekit-client';
import type { AudioCaptureOptions, TrackPublishOptions } from 'livekit-client';

// Shared program/game sound is not microphone speech. Keep its capture and encoder
// independent of microphone suppression, PTT and economy settings. Constraints are
// preferences: unsupported browsers may ignore them or return no screen audio.
export const screenAudioCaptureOptions: AudioCaptureOptions = {
  echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false,
};
export const screenAudioPublishOptions: TrackPublishOptions = {
  audioPreset: AudioPresets.music, dtx: false, red: true,
};

export type QualitySource = 'audio' | 'camera' | 'screen';
export type BasicQuality = 'standard' | 'economy';
export type ScreenQuality = BasicQuality | 'high' | 'ultra';
export type ScreenContent = 'auto' | 'detail' | 'motion';
export function savedScreenContent(): ScreenContent {
  try { const value = localStorage.getItem('dosvyazi-screen-content'); return value === 'motion' || value === 'detail' ? value : 'auto'; } catch { return 'auto'; }
}
export function screenIntent(content: ScreenContent, quality: ScreenQuality): { hint: 'motion' | 'detail'; degradationPreference: RTCDegradationPreference } {
  const motion = content === 'motion' || (content === 'auto' && quality === 'ultra');
  return { hint: motion ? 'motion' : 'detail', degradationPreference: motion ? 'maintain-framerate' : 'maintain-resolution' };
}
export type MediaQuality = { audio: BasicQuality; camera: BasicQuality; screen: ScreenQuality };

// Encoder ceilings are choices, not guaranteed delivered rates or measured savings.
export const cameraProfiles = {
  standard: { width: 640, height: 360, frameRate: 15, maxBitrate: 450_000 },
  economy: { width: 320, height: 180, frameRate: 10, maxBitrate: 150_000 },
} as const;
export const screenProfiles = {
  standard: { width: 1280, height: 720, frameRate: 15, maxBitrate: 1_200_000 },
  economy: { width: 854, height: 480, frameRate: 10, maxBitrate: 450_000 },
  high: { width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_000_000 },
  ultra: { width: 2560, height: 1440, frameRate: 60, maxBitrate: 12_000_000 },
} as const;
export function validQuality(source: QualitySource, value: string): value is ScreenQuality {
  return value === 'standard' || value === 'economy' || (source === 'screen' && (value === 'high' || value === 'ultra'));
}
export function savedMediaQuality(): MediaQuality {
  const quality: MediaQuality = { audio: 'standard', camera: 'standard', screen: 'standard' };
  for (const source of ['audio', 'camera', 'screen'] as const) {
    try { const value = localStorage.getItem(`dosvyazi-quality-${source}`); if (value && validQuality(source, value)) Object.assign(quality, { [source]: value }); }
    catch { /* Defaults also work without browser storage. */ }
  }
  return quality;
}
export function videoConstraints(source: 'camera' | 'screen', quality: MediaQuality): MediaTrackConstraints {
  const profile = source === 'camera' ? cameraProfiles[quality.camera] : screenProfiles[quality.screen];
  return { width: { ideal: profile.width, max: profile.width }, height: { ideal: profile.height, max: profile.height }, frameRate: { ideal: profile.frameRate, max: profile.frameRate } };
}
export function qualityPublishOptions(source: QualitySource, quality: MediaQuality, content: ScreenContent = 'auto'): TrackPublishOptions {
  if (source === 'audio') return { audioPreset: quality.audio === 'economy' ? AudioPresets.speech : AudioPresets.music, dtx: true, red: true };
  const profile = source === 'camera' ? cameraProfiles[quality.camera] : screenProfiles[quality.screen];
  const encoding = { maxBitrate: profile.maxBitrate, maxFramerate: profile.frameRate };
  return { videoCodec: 'vp8', simulcast: false, ...(source === 'screen' ? { screenShareEncoding: encoding, degradationPreference: screenIntent(content, quality.screen).degradationPreference } : { videoEncoding: encoding }) };
}
