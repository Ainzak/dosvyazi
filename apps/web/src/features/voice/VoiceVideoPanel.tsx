import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/LocaleContext';
import type { VoiceVideo, VoiceSnapshot } from './VoiceClient';

function VideoTile({ video, name, focused, focus }: { video: VoiceVideo; name: string; focused: boolean; focus: () => void }) {
  const { t } = useI18n();
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    video.track.attach(target);
    target.muted = true;
    return () => { video.track.detach(target); target.srcObject = null; };
  }, [video.track]);
  return <figure className={`voice-video-tile${focused ? ' is-focused' : ''}`}>
    <video ref={element} autoPlay muted playsInline aria-label={t('{name}: {source}', { name, source: t(video.source === 'screen' ? 'Screen share' : 'Camera') })} />
    <figcaption><span>{name} · {t(video.source === 'screen' ? 'Screen share' : 'Camera')}{video.local ? t(' · You') : ''}</span>
      <button className="secondary-button" aria-pressed={focused} onClick={focus}>{t(focused ? 'Show all videos' : 'Focus video')}</button></figcaption>
  </figure>;
}

export function VoiceVideoPanel({ state }: { state: VoiceSnapshot }) {
  const { t } = useI18n();
  const [selected, select] = useState<string | null>(null);
  const [expanded, expand] = useState(false);
  const focused = state.videos.some(video => video.id === selected) ? selected : null;
  if (state.status !== 'Connected' || state.videos.length === 0) return null;
  return <section className="voice-video-viewer" aria-label={t('Shared video')}>
    <button className="secondary-button" aria-expanded={expanded} onClick={() => expand(!expanded)}>{t(expanded ? 'Hide shared video' : 'View shared video ({value})', { value: state.videos.length })}</button>
    {expanded && <div className={`voice-videos${focused ? ' has-focus' : ''}`}>
    {state.videos.map(video => <VideoTile key={video.id} video={video}
      name={state.participants.find(member => member.identity === video.identity)?.displayName ?? (video.local ? t('You') : t('Participant'))}
      focused={focused === video.id} focus={() => select(focused === video.id ? null : video.id)} />)}
    </div>}
  </section>;
}
