import { LocalAudioTrack, LocalVideoTrack, Track } from 'livekit-client';
import type { LocalTrack, VideoResolution } from 'livekit-client';
import { screenAudioCaptureOptions } from './mediaQuality';

// LiveKit 2.22 does not forward windowAudio. Use the browser picker directly,
// retaining user-provided tracks so reconnect never starts capture silently.
export async function captureScreen(audio: boolean, systemAudio: boolean, resolution: VideoResolution, contentHint: string): Promise<LocalTrack[]> {
  const options: DisplayMediaStreamOptions & {
    windowAudio: 'window' | 'system'; systemAudio: 'include' | 'exclude'; selfBrowserSurface: 'exclude';
  } = {
    video: { width: { ideal: resolution.width }, height: { ideal: resolution.height }, ...(resolution.frameRate ? { frameRate: resolution.frameRate } : {}) },
    audio: audio ? { ...screenAudioCaptureOptions, restrictOwnAudio: true } as MediaTrackConstraints : false,
    windowAudio: systemAudio ? 'system' : 'window',
    systemAudio: audio && systemAudio ? 'include' : 'exclude', selfBrowserSurface: 'exclude',
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  try {
    const video = stream.getVideoTracks()[0];
    if (!video || video.readyState === 'ended') throw new Error('No screen capture was returned.');
    const screen = new LocalVideoTrack(video, undefined, true); screen.source = Track.Source.ScreenShare;
    // Match SDK capture: establish the initial hint before publication or sender
    // defaults can be mistaken for the confirmed application preference.
    video.contentHint = contentHint;
    const result: (LocalAudioTrack | LocalVideoTrack)[] = [screen];
    const sound = stream.getAudioTracks()[0];
    if (audio && sound) {
      const track = new LocalAudioTrack(sound, undefined, true); track.source = Track.Source.ScreenShareAudio; result.push(track);
    }
    for (const track of stream.getTracks()) if (!result.some(local => local.mediaStreamTrack === track)) track.stop();
    // SDK 2.22's own createLocalScreenTracks returns this base type. Its concrete
    // processor declaration is incompatible with exactOptionalPropertyTypes.
    return result as unknown as LocalTrack[];
  } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
}
