import { useI18n } from '../../i18n/LocaleContext';
import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { disconnectVoice, getVoice } from '../../api/voice';
import { communityKeys } from '../../api/communities';
import { useVoiceClient } from './VoiceContext';
import { VoiceVideoPanel } from './VoiceVideoPanel';

export function VoicePanel({ community, name, user, canView = true }: { community: string; name: string; user: string; canView?: boolean }) {
  const { t } = useI18n();
  const client = useVoiceClient();
  const voice = useSyncExternalStore(client.subscribe, client.snapshot);
  const query = useQuery({ queryKey: [...communityKeys(user, community), 'voice'], queryFn: ({ signal }) => getVoice(community, signal), refetchInterval: 4000, enabled: canView });
  const remove = useMutation({ mutationFn: (identity: string) => disconnectVoice(community, `${identity.slice(0, 8)}-${identity.slice(8, 12)}-${identity.slice(12, 16)}-${identity.slice(16, 20)}-${identity.slice(20)}`), onSuccess: () => { void query.refetch(); } });
  if (!canView) return <section className="voice-panel"><h2>{t("Voice unavailable.")}</h2><p>{t("You do not have access to this voice room.")}</p></section>;
  return <section className="voice-panel" aria-labelledby="voice-heading"><h2 id="voice-heading">{t("Voice room")}</h2>
    <p className="field-hint">{t("Members only. Join muted, then enable your microphone when ready.")}</p>
    {query.isPending ? <p role="status">{t("Checking voice room…")}</p> : query.isError ? <><p role="alert">{t("Voice is unavailable. ")}{t(query.error.message)}</p><button className="secondary-button" onClick={() => void query.refetch()}>{t("Retry voice check")}</button></> : <><p role="status">{query.data.status === 'Pending' ? t("Access changes pending. Reconnecting members after confirmation.") : query.data.controlUnavailable ? t("Voice service is unavailable.") : query.data.participants.length === 0 ? t("No one is in voice yet.") : t("{value} in voice", { value: query.data.participants.length })}</p>
        {!query.data.canSpeak && <p>{t("Listen only: ")}{query.data.deniedBy}</p>}
        {!query.data.canConnect && <p>{t("You cannot join: ")}{query.data.deniedBy}</p>}
        <ul className="voice-participants">{query.data.participants.map(member => {
          const speaking = voice.community === community && voice.status === 'Connected' && voice.speakers.includes(member.identity);
          return <li key={member.identity} className={speaking ? 'is-speaking' : ''}><span className="voice-participant-info"><span className="voice-participant-name">{member.displayName}</span><span className="voice-speaking-state" aria-label={speaking ? t("Speaking") : t("Not speaking")}>{speaking ? t("Speaking") : t("Not speaking")}</span></span>{query.data.canModerate && <button className="secondary-button" disabled={remove.isPending} aria-label={t("Disconnect {value}", { value: member.displayName })} onClick={() => remove.mutate(member.identity)}>{t("Disconnect")}</button>}</li>;
        })}</ul></>}
    {remove.isError && <p role="alert">{t(remove.error.message)}</p>}
    {voice.community === community ? <p>{t("Use the voice controls below. You can keep reading text channels.")}</p> : <button className="primary-button" disabled={query.isPending || query.isError || !query.data?.canConnect || query.data?.status === 'Pending' || query.data?.controlUnavailable || !!voice.community}
        onClick={() => void client.join(community, name, true)}>{t("Join voice")}</button>}
    {voice.community && voice.community !== community && <p>{t("Leave your current voice room before joining here.")}</p>}
  </section>;
}

export function VoiceDock() {
  const { t } = useI18n();
  const client = useVoiceClient();
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  const [screenAudio, setScreenAudio] = useState(false);
  if (!state.community) return state.error ? <p className="voice-notice" role="alert">{t(state.error)}</p> : null;
  const connected = state.status === 'Connected';
  return <section className="voice-dock" aria-label={t("Voice controls")}>
    <div><Link to={`/communities/${state.community}`}>{state.name} {t(" · Voice")}</Link><p role="status">{t(state.status)}{state.muted ? t(" · Muted") : t(" · Microphone on")}{state.deafened ? t(" · Deafened") : ''}</p></div>
    {!state.canSpeak && <p>{t("Listen only. SpeakVoice is denied.")}</p>}
    <div className="voice-actions"><button className="secondary-button" disabled={!connected || state.deafened || state.changingAudio || !state.canSpeak} onClick={() => void client.microphone(!state.muted)}>{state.muted ? t("Enable microphone") : t("Mute microphone")}</button>
      <button className="secondary-button" disabled={!connected || state.changingAudio} onClick={() => void client.deafen(!state.deafened)}>{state.deafened ? t("Undeafen") : t("Deafen")}</button>
      <button className="secondary-button" disabled={state.status === 'Joining' || state.status === 'Leaving'} onClick={() => void client.leave()}>{state.status === 'Leave not confirmed' ? t("Retry leave") : t("Leave voice")}</button>
      {!connected && !['Joining', 'Leaving', 'Access updating', 'Leave not confirmed'].includes(state.status) && <button className="secondary-button" onClick={() => void client.join(state.community!, state.name, true)}>{t("Reconnect voice")}</button>}</div>
    <div className="voice-media-actions"><button className="secondary-button" disabled={!connected || !state.canUseCamera || state.changingMedia} onClick={() => void client.media('camera', !state.camera)}>{t(state.camera ? 'Stop camera' : 'Enable camera')}</button>
      <button className="secondary-button" disabled={!connected || !state.canShareScreen || state.changingMedia || !navigator.mediaDevices?.getDisplayMedia} onClick={() => void client.media('screen', !state.sharing, screenAudio)}>{t(state.sharing ? 'Stop sharing' : 'Share screen')}</button>
      <label className="voice-screen-audio"><input type="checkbox" checked={screenAudio} disabled={state.sharing || state.changingMedia || !state.canShareScreen} onChange={event => setScreenAudio(event.target.checked)} />{t('Include screen audio when available')}</label>
    </div>
    {!navigator.mediaDevices?.getDisplayMedia && <p className="field-hint">{t('Screen capture is unavailable in this browser. You can still watch shared screens.')}</p>}
    {state.canSpeak && !state.canShareScreen && <p className="field-hint">{t('Screen sharing is not allowed in this room.')}</p>}
    {state.canSpeak && !state.canUseCamera && <p className="field-hint">{t('Camera sharing is not allowed in this room.')}</p>}
    <p className="field-hint">{t('Screen audio depends on your browser and chosen source. Camera and screen sharing stay off after reconnecting.')}</p>
    <VoiceVideoPanel state={state} />
    {state.mediaError && <div role="alert"><p>{t(state.mediaError)}</p><button className="secondary-button" onClick={() => client.clearMediaError()}>{t('Dismiss media notice')}</button></div>}
    <label className="voice-volume">{t('Output volume')} <output>{state.volume}%</output><input aria-label={t('Output volume')} type="range" min="0" max="100" step="1" value={state.volume} onChange={event => client.volume(Number(event.target.value))} /></label>
    {connected && state.playbackBlocked && <div className="voice-playback-notice"><p role="status">{t('Your browser blocked other participants’ audio. Allow playback to hear them. This does not play your own microphone.')}</p><button className="primary-button" disabled={state.startingPlayback} onClick={() => void client.playback()}>{t(state.startingPlayback ? 'Starting playback…' : 'Allow audio playback')}</button></div>}
    <details className="voice-device-settings"><summary>{t("Media devices")}</summary><div className="voice-devices"><label>{t("Microphone")}<select aria-label={t("Microphone device")} disabled={!connected} value={state.input} onChange={event => void client.device('audioinput', event.target.value)}><option value="default">{t("System default")}</option>{state.devices.filter(item => item.kind === 'audioinput' && item.deviceId !== 'default').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || t("Microphone {value}", { value: i + 1 })}</option>)}</select></label>
      <label>{t("Speaker")}<select aria-label={t("Speaker device")} disabled={!connected || !('setSinkId' in HTMLMediaElement.prototype)} value={state.output} onChange={event => void client.device('audiooutput', event.target.value)}><option value="default">{t("System default")}</option>{state.devices.filter(item => item.kind === 'audiooutput' && item.deviceId !== 'default').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || t("Speaker {value}", { value: i + 1 })}</option>)}</select></label><label>{t('Camera')}<select aria-label={t('Camera device')} disabled={!connected || state.camera || state.changingMedia} value={state.cameraDevice} onChange={event => client.cameraDevice(event.target.value)}><option value="default">{t('System default')}</option>{state.devices.filter(item => item.kind === 'videoinput').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || t('Camera {value}', { value: i + 1 })}</option>)}</select></label></div></details>
    {state.error && <p role="alert" className="form-error">{t(state.error)}</p>}
  </section>;
}
