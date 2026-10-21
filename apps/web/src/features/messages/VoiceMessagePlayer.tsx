import { useEffect, useRef, useState } from 'react';
import { callApi, readJson } from '../../api/http';
import { claimMedia, releaseMedia } from './mediaBudget';
import { useI18n } from '../../i18n/LocaleContext';

export function VoiceMessagePlayer({ url, duration }: { url: string; duration: number }) {
  const { t } = useI18n(); const [audio, setAudio] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const owned = useRef<string | null>(null); const request = useRef<AbortController | null>(null); const mounted = useRef(false);
  const mediaOwner = useRef(Symbol('voice'));
  const element = useRef<HTMLAudioElement>(null);
  useEffect(() => { const node = element.current; return () => { if (node) { node.pause(); node.removeAttribute('src'); node.load(); } }; }, [audio]);
  useEffect(() => { mounted.current = true; const owner = mediaOwner.current; return () => { mounted.current = false; releaseMedia(owner); request.current?.abort(); if (owned.current) URL.revokeObjectURL(owned.current); owned.current = null; }; }, [url]);
  async function load() {
    if (request.current || owned.current) return;
    const controller = new AbortController(); request.current = controller; setLoading(true); setError(null);
    try {
      const response = await callApi(url, { signal: controller.signal }); if (!response.ok) await readJson(response); const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024 || ![0x1a, 0x45, 0xdf, 0xa3].every((value, index) => bytes[index] === value)) throw new Error('Voice playback is unavailable. You can retry or download the file.');
      if (!mounted.current || controller.signal.aborted) return;
      const target = URL.createObjectURL(new Blob([bytes], { type: 'audio/webm;codecs=opus' })); claimMedia(mediaOwner.current, hide); owned.current = target; setAudio(target);
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Voice playback is unavailable. You can retry or download the file.'); }
    finally { if (request.current === controller) { request.current = null; if (mounted.current) setLoading(false); } }
  }
  function hide() { releaseMedia(mediaOwner.current); element.current?.pause(); request.current?.abort(); request.current = null; if (owned.current) URL.revokeObjectURL(owned.current); owned.current = null; setAudio(null); setLoading(false); }
  return <div className="voice-message-player"><p>{t('Voice message · {value}s', { value: Math.round(duration / 100) / 10 })}</p>
    {audio ? <><audio ref={element} controls preload="metadata" src={audio} aria-label={t('Voice message playback')} onError={() => setError('Voice playback is unavailable. You can retry or download the file.')} /><button type="button" className="secondary-button" onClick={hide}>{t('Close voice message')}</button></> : <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>{t(loading ? 'Loading voice message…' : 'Load voice message')}</button>}
    {loading && <button type="button" className="secondary-button" onClick={hide}>{t('Cancel loading')}</button>}
    {error && <p role="alert">{t(error)}</p>}
  </div>;
}
