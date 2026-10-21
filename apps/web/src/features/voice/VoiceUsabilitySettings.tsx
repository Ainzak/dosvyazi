import { useI18n } from '../../i18n/LocaleContext';
import type { VoiceClient, VoiceSnapshot } from './VoiceClient';

export function VoiceUsabilitySettings({ state, client }: { state: VoiceSnapshot; client: VoiceClient }) {
  const { t } = useI18n();
  const busy = state.status !== 'Connected' || state.changingAudio || !!state.changingQuality || state.changingNoiseSuppression;
  const members = state.participants.filter(member => member.identity !== state.identity);
  return <>
    <fieldset className="voice-quality-settings"><legend>{t('Push to talk')}</legend>
      <label><input type="checkbox" checked={state.pushToTalk} disabled={busy || (!state.pushToTalk && (!state.canSpeak || typeof AudioContext === 'undefined' || !navigator.mediaDevices?.getUserMedia))} onChange={event => void client.pushToTalk(event.target.checked)} /><span>{t('Hold to transmit microphone audio')}</span></label>
      <label>{t('Push-to-talk key')}<select aria-label={t('Push-to-talk key')} value={state.pttKey} disabled={busy || state.pttHeld} onChange={event => client.pttKey(event.target.value as VoiceSnapshot['pttKey'])}><option value="KeyV">V / М</option><option value="KeyB">B / И</option><option value="ControlRight">{t('Right Control')}</option></select></label>
      <p className="field-hint">{t('The shortcut uses a physical key in this tab, outside text fields. Hold the on-screen button on touch devices. Releasing, changing tabs or losing focus mutes you.')}</p>
      {state.pushToTalk && <p className="field-hint">{t('After the first hold, your microphone stays captured for fast response. Only held audio is transmitted. Change mode or leave to release capture. Switch to continuous mode to change microphone devices or processing.')}</p>}
    </fieldset>
    <fieldset className="voice-quality-settings"><legend>{t('Participant playback')}</legend>
      <p className="field-hint">{t('For you only, in this connection. Each level combines with output volume and applies to voice and shared audio. Mute for me does not disconnect anyone.')}</p>
      {members.length === 0 && <p>{t('No other participants yet.')}</p>}
      {members.map(member => {
        const level = state.participantAudio[member.identity] ?? { volume: 100, muted: false };
        return <div className="voice-person-level" key={member.identity}><label><span>{member.displayName} · <output>{level.volume}%</output></span><input type="range" min="0" max="100" step="1" aria-label={t('{name} playback volume', { name: member.displayName })} value={level.volume} onChange={event => client.participantLevel(member.identity, Number(event.target.value), level.muted)} /></label>
          <label><input type="checkbox" checked={level.muted} onChange={event => client.participantLevel(member.identity, level.volume, event.target.checked)} /><span>{t('Mute {name} for me', { name: member.displayName })}</span></label></div>;
      })}
    </fieldset>
  </>;
}

export function HoldToTalk({ state, client }: { state: VoiceSnapshot; client: VoiceClient }) {
  const { t } = useI18n();
  if (!state.pushToTalk) return null;
  return <button className={`voice-hold-button${state.pttHeld ? ' is-held' : ''}`} disabled={state.status !== 'Connected' || state.deafened || !state.canSpeak || typeof AudioContext === 'undefined' || !navigator.mediaDevices?.getUserMedia} aria-pressed={state.pttHeld}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); void client.holdToTalk(true); }}
    onPointerUp={() => void client.holdToTalk(false)} onPointerCancel={() => void client.holdToTalk(false)} onLostPointerCapture={() => void client.holdToTalk(false)}
    onKeyDown={event => { if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); if (!event.repeat) void client.holdToTalk(true); } }}
    onKeyUp={event => { if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); void client.holdToTalk(false); } }}
    onBlur={() => void client.holdToTalk(false)}>{t('Hold to talk')}</button>;
}
