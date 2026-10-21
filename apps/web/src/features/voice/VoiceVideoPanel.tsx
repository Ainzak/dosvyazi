import { useEffect, useRef, useState } from 'react';
import { Maximize2, MonitorUp, Video } from 'lucide-react';
import { useLocation } from 'react-router';
import { useI18n } from '../../i18n/LocaleContext';
import type { VoiceVideo, VoiceSnapshot } from './VoiceClient';

function VideoTile({ video, name, focused, focus, stop, busy, receive, allowed }: { video: VoiceVideo; name: string; focused: boolean; focus: (button: HTMLButtonElement) => void; stop: () => void; busy: boolean; receive: (enabled: boolean) => void; allowed: boolean }) {
  const { t } = useI18n();
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const target = element.current;
    const track = video.track;
    if (!target || !track || !video.receiving) return;
    track.attach(target);
    target.muted = true;
    return () => { track.detach(target); target.srcObject = null; };
  }, [video.track, video.receiving]);
  return <figure className={`voice-video-tile${focused ? ' is-focused' : ''}`}>
    {video.receiving && video.track ? <video ref={element} autoPlay muted playsInline aria-label={t('{name}: {source}', { name, source: t(video.source === 'screen' ? 'Screen share' : 'Camera') })} /> : <p className="voice-video-placeholder">{t(video.receiving ? 'Waiting for this video' : 'This video is not being received')}</p>}
    <figcaption><span className="voice-video-label">{video.source === 'screen' ? <MonitorUp size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />}<span>{name} · {t(video.source === 'screen' ? 'Screen share' : 'Camera')}{video.local ? t(' · You') : ''}</span></span><div className="voice-video-actions">
      <button className="secondary-button" aria-pressed={focused} onClick={event => focus(event.currentTarget)}><Maximize2 size={16} aria-hidden="true" />{t(focused ? 'Show all videos' : 'Focus video')}</button>
      {video.local && <button className="secondary-button stop-local-video" disabled={busy} onClick={stop}>{t(video.source === 'screen' ? 'Stop your screen share' : 'Stop your camera')}</button>}
    </div></figcaption>
    {!video.local && <label className="voice-receive-toggle"><input type="checkbox" checked={video.receiving} disabled={!allowed} onChange={event => receive(event.target.checked)} />{t('Receive {name}: {source}', { name, source: t(video.source === 'screen' ? 'Screen share' : 'Camera') })}</label>}
  </figure>;
}

export function VoiceVideoPanel({ state, stop, receive }: { state: VoiceSnapshot; stop: (video: VoiceVideo) => void; receive: (id: string, enabled: boolean) => void }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [viewPath, setViewPath] = useState(pathname);
  const [selected, select] = useState<string | null>(null);
  const [expanded, expand] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusButton = useRef<HTMLButtonElement | null>(null);
  // Exit the focused view on navigation without detaching the gallery or voice.
  if (viewPath !== pathname) { setViewPath(pathname); select(null); }
  const focused = state.videos.some(video => video.id === selected) ? selected : null;
  useEffect(() => { if (selected && !focused) trigger.current?.focus(); }, [selected, focused]);
  if (state.status !== 'Connected' || state.videos.length === 0) return null;
  return <section className={`voice-video-viewer${expanded && focused ? ' is-focused-view' : ''}`} aria-label={t('Shared video')} onKeyDown={event => {
    if (event.key !== 'Escape' || !expanded) return;
    event.stopPropagation();
    if (focused) { select(null); focusButton.current?.focus(); }
    else { select(null); expand(false); trigger.current?.focus(); }
  }}>
    <div className="voice-viewer-heading"><div><h2>{t('Shared video')}</h2>{expanded && <p>{state.name} · {t('Voice continues while you watch.')}</p>}</div>
    <button ref={trigger} className="secondary-button" aria-expanded={expanded} onClick={() => { select(null); expand(!expanded); }}>{t(expanded ? 'Hide shared video' : 'View shared video ({value})', { value: state.videos.length })}</button></div>
    {expanded && <p className="field-hint">{t('Hiding video does not stop your camera or screen share. Use Stop to end your broadcast.')}</p>}
    {expanded && <div className={`voice-videos${focused ? ' has-focus' : ''}`}>
    {state.videos.map(video => <VideoTile key={video.id} video={video}
      name={state.participants.find(member => member.identity === video.identity)?.displayName ?? (video.local ? t('You') : t('Participant'))}
      focused={focused === video.id} focus={button => { focusButton.current = button; select(focused === video.id ? null : video.id); }} stop={() => stop(video)} busy={state.changingMedia}
      receive={enabled => receive(video.id, enabled)} allowed={state.receiving === 'all' || (state.receiving === 'screen' && video.source === 'screen')} />)}
    </div>}
  </section>;
}
