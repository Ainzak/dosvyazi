import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/LocaleContext';
import { prepareVoiceDraft } from './voiceDraft';

export function VoiceRecorder({ file, disabled, ready, busy }: { file: File | null; disabled: boolean; ready: (file: File | null) => void; busy: (recording: boolean) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'starting' | 'recording' | 'preparing'>('idle');
  const [seconds, setSeconds] = useState(0); const [error, setError] = useState<string | null>(null); const preview = useRef<HTMLAudioElement>(null);
  const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null); const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const epoch = useRef(0); const locked = useRef(false); const callbacks = useRef({ ready, busy });
  useEffect(() => { callbacks.current = { ready, busy }; }, [ready, busy]);
  useEffect(() => () => {
    epoch.current++; if (timer.current) clearInterval(timer.current); if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    callbacks.current.busy(false);
  }, []);
  useEffect(() => { const target = preview.current; if (!file || !target) return; const url = URL.createObjectURL(file); target.src = url; return () => { target.pause(); target.removeAttribute('src'); target.load(); URL.revokeObjectURL(url); }; }, [file]);
  const supported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') && !!navigator.mediaDevices?.getUserMedia;
  const stop = useCallback((cancel = false) => {
    if (cancel) { epoch.current++; locked.current = false; setStatus('idle'); callbacks.current.busy(false); callbacks.current.ready(null); }
    if (timer.current) clearInterval(timer.current); timer.current = null;
    if (recorder.current?.state === 'recording') { if (!cancel) setStatus('preparing'); recorder.current.stop(); }
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
  }, []);
  useEffect(() => {
    const background = () => { if (document.hidden && recorder.current?.state === 'recording') stop(); };
    document.addEventListener('visibilitychange', background);
    return () => document.removeEventListener('visibilitychange', background);
  }, [stop]);
  async function start() {
    if (locked.current || disabled || !supported) return;
    locked.current = true; const current = ++epoch.current; setError(null); setStatus('starting'); setSeconds(0); callbacks.current.busy(true);
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
      if (current !== epoch.current) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream.current = acquired; const capture = new MediaRecorder(acquired, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 }); recorder.current = capture;
      const chunks: Blob[] = []; let size = 0; let tooLarge = false;
      capture.ondataavailable = event => { if (current !== epoch.current || !event.data.size) return; size += event.data.size; if (size > 2 * 1024 * 1024) { tooLarge = true; stop(); } else chunks.push(event.data); };
      capture.onerror = () => { if (current === epoch.current) { stop(true); setError('Recording failed. Check your microphone and try again.'); } };
      capture.onstop = async () => {
        if (current !== epoch.current) return;
        stop(); setStatus('preparing');
        try {
          if (tooLarge || !size) throw new Error('Voice recording exceeds 2 MiB. Record a shorter message.');
          const draft = await prepareVoiceDraft(new Blob(chunks, { type: capture.mimeType }));
          if (current === epoch.current) callbacks.current.ready(draft);
        } catch (failure) { if (current === epoch.current) setError(failure instanceof Error ? failure.message : 'Recording failed. Check your microphone and try again.'); }
        finally { if (current === epoch.current) { setStatus('idle'); locked.current = false; callbacks.current.busy(false); } }
      };
      capture.start(250); setStatus('recording'); const started = performance.now();
      timer.current = setInterval(() => { if (current !== epoch.current) return; const elapsed = performance.now() - started; setSeconds(Math.floor(elapsed / 1000)); if (elapsed >= 59000) stop(); }, 100);
    } catch { if (current === epoch.current) { stop(true); setError('Microphone unavailable. Allow microphone access and try again.'); } }
  }
  return <div className="voice-recorder">
    {!supported && <p className="field-hint">{t('Voice recording is unavailable in this browser. Text and file messages still work.')}</p>}
    {status === 'idle' && !file && <button type="button" className="secondary-button" disabled={disabled || !supported} onClick={() => void start()}>{t('Record voice message')}</button>}
    {status !== 'idle' && <><p role="status">{t(status === 'recording' ? 'Recording your microphone: {value}s' : status === 'starting' ? 'Waiting for microphone permission…' : 'Preparing voice recording…', { value: seconds })}</p>
      {status === 'recording' && <button type="button" className="secondary-button" onClick={() => stop()}>{t('Stop recording')}</button>}
      <button type="button" className="secondary-button" onClick={() => stop(true)}>{t('Cancel recording')}</button></>}
    {file && <><p>{t('Voice message preview')}</p><audio ref={preview} controls preload="metadata" aria-label={t('Voice message preview')} /><button type="button" className="secondary-button" disabled={disabled} onClick={() => callbacks.current.ready(null)}>{t('Discard voice recording')}</button></>}
    <p className="field-hint">{t('Record only your own microphone, up to 60 seconds and 2 MiB. Preview before sending.')}</p>
    {error && <p role="alert">{t(error)}</p>}
  </div>;
}
