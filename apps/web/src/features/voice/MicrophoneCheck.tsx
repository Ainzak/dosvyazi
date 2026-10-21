import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/LocaleContext';
import { microphoneFailure } from './microphoneFailure';

export function MicrophoneCheck({ input, choose }: { input: string; choose: (id: string) => void }) {
  const { t } = useI18n();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [running, setRunning] = useState(false), [pending, setPending] = useState(false), [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0), [silent, setSilent] = useState(false), [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const sequence = useRef(0);
  const resources = useRef<{ stream?: MediaStream; context?: AudioContext; source?: MediaStreamAudioSourceNode; analyser?: AnalyserNode; timer?: ReturnType<typeof setInterval> }>({});
  const release = () => {
    sequence.current++;
    const current = resources.current; resources.current = {};
    clearInterval(current.timer); current.stream?.getTracks().forEach(track => track.stop());
    current.source?.disconnect(); current.analyser?.disconnect();
    if (current.context) void current.context.close().catch(() => {});
    if (audio.current) { audio.current.pause(); audio.current.srcObject = null; }
  };
  const stop = () => { release(); setRunning(false); setPending(false); setListening(false); setLevel(0); setSilent(false); };
  useEffect(() => {
    const stopHidden = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', stopHidden);
    return () => { window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stopHidden); release(); };
    // Resource owners are refs; capture is started only by the explicit button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = async () => {
    stop(); setError(null); setPending(true); const epoch = sequence.current;
    try {
      const context = new AudioContext(); resources.current.context = context;
      void context.resume().catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: input === 'default' ? true : { deviceId: { exact: input } }, video: false });
      if (sequence.current !== epoch) { stream.getTracks().forEach(track => track.stop()); return; }
      resources.current.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== 'live') throw new DOMException('No live input', 'NotReadableError');
      const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
      resources.current.source = source; resources.current.analyser = analyser;
      await context.resume();
      if (sequence.current !== epoch) return;
      const samples = new Float32Array(512), started = performance.now(); let lastSound = started;
      resources.current.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        if (rms >= .01) lastSound = performance.now();
        setLevel(Math.min(100, Math.round(rms * 400))); setSilent(performance.now() - lastSound > 2000);
      }, 100);
      track.addEventListener('ended', () => { if (sequence.current === epoch) { stop(); setError('The microphone stopped. Start the check again.'); } }, { once: true });
      setRunning(true); setPending(false);
      const listed = await navigator.mediaDevices.enumerateDevices();
      if (sequence.current === epoch) setDevices(listed.filter(device => device.kind === 'audioinput' && device.deviceId !== 'default'));
    } catch (failure) { if (sequence.current === epoch) { stop(); setError(microphoneFailure(failure)); } }
  };
  const listen = async () => {
    const target = audio.current, stream = resources.current.stream;
    if (!target || !stream) return;
    if (listening) { target.pause(); target.srcObject = null; setListening(false); return; }
    const epoch = sequence.current; target.srcObject = stream; target.volume = .25;
    try { await target.play(); if (sequence.current === epoch) setListening(true); }
    catch { if (sequence.current === epoch) setError('Local listening could not start. Try again.'); }
  };
  const refresh = async () => {
    const epoch = sequence.current;
    try {
      const listed = await navigator.mediaDevices.enumerateDevices();
      if (sequence.current === epoch) setDevices(listed.filter(device => device.kind === 'audioinput' && device.deviceId !== 'default'));
    } catch { if (sequence.current === epoch) setError('Audio devices could not be listed.'); }
  };
  return <details className="voice-microphone-check"><summary>{t('Check microphone before joining')}</summary>
    <p className="field-hint">{t('A local signal check. Nothing is recorded, uploaded or sent to the voice room. Use headphones for local listening.')}</p>
    {(!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') && <p>{t('Local microphone checking is unavailable in this browser.')}</p>}
    <label>{t('Microphone for this call')}<select aria-label={t('Microphone for this call')} value={input} disabled={pending || running} onChange={event => choose(event.target.value)}><option value="default">{t('System default')}</option>{input !== 'default' && !devices.some(device => device.deviceId === input) && <option value={input}>{t('Selected microphone (not listed)')}</option>}{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || t('Microphone {value}', { value: index + 1 })}</option>)}</select></label>
    <div className="voice-check-actions"><button className="secondary-button" disabled={pending || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined'} onClick={() => void start()}>{t(pending ? 'Starting microphone check…' : 'Start microphone check')}</button>
      {(pending || running) && <button className="secondary-button" onClick={stop}>{t('Stop microphone check')}</button>}
      {!pending && !running && <button className="secondary-button" disabled={!navigator.mediaDevices?.enumerateDevices} onClick={() => void refresh()}>{t('Refresh microphones')}</button>}
      {running && <button className="secondary-button" onClick={() => void listen()}>{t(listening ? 'Stop local listening' : 'Listen locally')}</button>}</div>
    {running && <><label>{t('Microphone signal')}<meter aria-label={t('Microphone signal')} min="0" max="100" value={level} /></label><p role="status">{t(silent ? 'No signal detected. Check the selected input and hardware mute switch.' : 'Microphone check is running locally.')}</p></>}
    {error && <p role="alert">{t(error)}</p>}{running && <audio ref={audio} hidden />}
  </details>;
}
