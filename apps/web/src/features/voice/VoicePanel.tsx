import { useI18n } from '../../i18n/LocaleContext';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, Phone, SlidersHorizontal, Video, VideoOff, Volume2 } from 'lucide-react';
import { disconnectVoice, getVoice } from '../../api/voice';
import { communityKeys } from '../../api/communities';
import { useVoiceClient } from './VoiceContext';
import { VoiceVideoPanel } from './VoiceVideoPanel';
import { MediaQualitySettings } from './MediaQualitySettings';
import { ReceivingSettings } from './ReceivingSettings';
import { MicrophoneCheck } from './MicrophoneCheck';
import { HoldToTalk, VoiceUsabilitySettings } from './VoiceUsabilitySettings';

export function VoicePanel({ community, name, user, canView = true, focused = false }: { community: string; name: string; user: string; canView?: boolean; focused?: boolean }) {
  const { t } = useI18n();
  const client = useVoiceClient();
  const voice = useSyncExternalStore(client.subscribe, client.snapshot);
  const query = useQuery({ queryKey: [...communityKeys(user, community), 'voice'], queryFn: ({ signal }) => getVoice(community, signal), refetchInterval: 4000, enabled: canView });
  const remove = useMutation({ mutationFn: (identity: string) => disconnectVoice(community, `${identity.slice(0, 8)}-${identity.slice(8, 12)}-${identity.slice(12, 16)}-${identity.slice(16, 20)}-${identity.slice(20)}`), onSuccess: () => { void query.refetch(); } });
  if (!canView) return <section className="voice-panel"><h2>{t("Voice unavailable.")}</h2><p>{t("You do not have access to this voice room.")}</p></section>;
  const Heading = focused ? 'h1' : 'h2';
  const connected = voice.community === community && voice.status === 'Connected';
  return <section className={`voice-panel${focused ? ' is-room' : ''}`} aria-labelledby="voice-heading"><div className="voice-room-heading"><span className="voice-room-symbol" aria-hidden="true"><Volume2 size={28} /></span><div><p className="eyebrow">{name}</p><Heading id="voice-heading">{t("Voice room")}</Heading></div></div>
    <p className="field-hint">{t("Members only. Join muted, then enable your microphone when ready.")}</p>
    {query.isPending ? <p role="status">{t("Checking voice room…")}</p> : query.isError ? <><p role="alert">{t("Voice is unavailable. ")}{t(query.error.message)}</p><button className="secondary-button" onClick={() => void query.refetch()}>{t("Retry voice check")}</button></> : <><p role="status">{query.data.status === 'Pending' ? t("Access changes pending. Reconnecting members after confirmation.") : query.data.controlUnavailable ? t("Voice service is unavailable.") : query.data.participants.length === 0 ? t("No one is in voice yet.") : t("{value} in voice", { value: query.data.participants.length })}</p>
        {!query.data.canSpeak && <p>{t("Listen only: ")}{query.data.deniedBy}</p>}
        {!query.data.canConnect && <p>{t("You cannot join: ")}{query.data.deniedBy}</p>}
        <ul className="voice-participants" aria-label={t('Participants in voice')}>{query.data.participants.map(member => {
          const speaking = connected && voice.speakers.includes(member.identity);
          const own = voice.community === community && member.identity === voice.identity;
          const ownMuted = own && voice.community === community && voice.muted;
          return <li key={member.identity} className={speaking ? 'is-speaking' : ''}><span className="voice-participant-avatar" aria-hidden="true">{Array.from(member.displayName.trim()).slice(0, 2).join('').toLocaleUpperCase()}</span><span className="voice-participant-info"><span className="voice-participant-name">{member.displayName}{own ? t(' · You') : ''}</span><span className="voice-speaking-state" aria-label={ownMuted ? t('Microphone muted') : speaking ? t("Speaking") : t("Not speaking")}>{ownMuted ? <MicOff size={16} aria-hidden="true" /> : own ? <Mic size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}{speaking ? t("Speaking") : ownMuted ? t('Microphone muted') : t("Not speaking")}</span>{own && !voice.canSpeak && <small>{t('Listen only')}</small>}</span>{own ? <button className="secondary-button" disabled={voice.status === 'Joining' || voice.status === 'Leaving'} onClick={() => void client.leave()}>{t('Leave channel')}</button> : query.data.canModerate && <button className="secondary-button" disabled={remove.isPending} aria-label={t("Disconnect {value}", { value: member.displayName })} onClick={() => remove.mutate(member.identity)}>{t("Disconnect")}</button>}</li>;
        })}</ul></>}
    {remove.isError && <p role="alert">{t(remove.error.message)}</p>}
    {!voice.community && <MicrophoneCheck key={`${user}:${community}`} input={voice.input} choose={id => client.inputPreference(id)} />}
    {voice.community === community ? <div className="voice-room-session"><p role="status">{t(voice.status)}{voice.muted ? t(' · Muted') : t(' · Microphone on')}{voice.deafened ? t(' · Deafened') : ''}</p><p>{t('Your voice controls stay available while you browse.')}</p>{connected && (voice.camera || voice.sharing) && <p className="voice-publishing-notice">{t(voice.sharing ? 'You are sharing your screen.' : 'Your camera is on.')}</p>}</div> : <button className="primary-button" disabled={query.isPending || query.isError || !query.data?.canConnect || query.data?.status === 'Pending' || query.data?.controlUnavailable || !!voice.community}
        onClick={() => void client.join(community, name, true)}>{t("Join voice")}</button>}
    {voice.community && voice.community !== community && <p>{t("Leave your current voice room before joining here.")}</p>}
  </section>;
}

export function VoiceDock() {
  const { t } = useI18n();
  const client = useVoiceClient();
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  const [screenAudio, setScreenAudio] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const closeSettings = () => { setSettingsOpen(false); settingsButton.current?.focus(); };
  if (!state.community) return state.error ? <p className="voice-notice" role="alert">{t(state.error)}</p> : null;
  const connected = state.status === 'Connected';
  return <section className="voice-dock" aria-label={t("Voice controls")}>
    <div className="voice-dock-heading"><Volume2 size={18} aria-hidden="true" /><Link to={`/communities/${state.community}/voice`}>{state.name} {t(" · Voice")}</Link></div><p role="status">{t(state.status)}{state.muted ? t(" · Muted") : t(" · Microphone on")}{state.deafened ? t(" · Deafened") : ''}</p>
    {!state.canSpeak && <p>{t("Listen only. SpeakVoice is denied.")}</p>}
    <div className="voice-actions"><button className={`icon-button${state.muted ? ' is-muted' : ' is-active'}`} aria-label={state.muted ? t('Enable microphone') : t('Mute microphone')} title={state.muted ? t('Enable microphone') : t('Mute microphone')} aria-pressed={!state.muted} disabled={!connected || state.pushToTalk || state.deafened || (state.changingAudio && !(state.changingQuality === 'audio' && !state.muted)) || !state.canSpeak} onClick={() => void client.microphone(!state.muted)}>{state.muted ? <MicOff size={22} aria-hidden="true" /> : <Mic size={22} aria-hidden="true" />}</button>
      <button className={`icon-button${state.deafened ? ' is-muted' : ''}`} aria-label={state.deafened ? t('Undeafen') : t('Deafen')} title={state.deafened ? t('Undeafen') : t('Deafen')} aria-pressed={state.deafened} disabled={!connected || (state.changingAudio && !((state.changingQuality === 'audio' || state.pushToTalk) && !state.deafened))} onClick={() => void client.deafen(!state.deafened)}>{state.deafened ? <HeadphoneOff size={22} aria-hidden="true" /> : <Headphones size={22} aria-hidden="true" />}</button>
      <button ref={settingsButton} className="icon-button" aria-label={t('Audio and sharing settings')} title={t('Audio and sharing settings')} aria-expanded={settingsOpen} aria-controls="voice-settings" onClick={() => setSettingsOpen(!settingsOpen)}><SlidersHorizontal size={22} aria-hidden="true" /></button>
      <button className="icon-button is-muted" aria-label={state.status === 'Leave not confirmed' ? t('Retry leave') : t('Leave voice')} title={state.status === 'Leave not confirmed' ? t('Retry leave') : t('Leave voice')} disabled={state.status === 'Joining' || state.status === 'Leaving'} onClick={() => void client.leave()}><Phone size={22} className="hangup-icon" aria-hidden="true" /></button>
      <button className={`icon-button${state.camera ? ' is-active' : ''}`} aria-label={t(state.camera ? 'Stop camera' : 'Enable camera')} title={t(state.camera ? 'Stop camera' : 'Enable camera')} aria-pressed={state.camera} disabled={!connected || !state.canUseCamera || state.changingMedia} onClick={() => void client.media('camera', !state.camera)}>{state.camera ? <Video size={22} aria-hidden="true" /> : <VideoOff size={22} aria-hidden="true" />}</button>
      <button className={`icon-button${state.sharing ? ' is-active' : ''}`} aria-label={t(state.sharing ? 'Stop sharing' : 'Share screen')} title={t(state.sharing ? 'Stop sharing' : 'Share screen')} aria-pressed={state.sharing} disabled={!connected || !state.canShareScreen || state.changingMedia || !navigator.mediaDevices?.getDisplayMedia} onClick={() => void client.media('screen', !state.sharing, screenAudio)}><MonitorUp size={22} aria-hidden="true" /></button>
      {!connected && !['Joining', 'Leaving', 'Access updating', 'Leave not confirmed'].includes(state.status) && <button className="secondary-button" onClick={() => void client.join(state.community!, state.name, true)}>{t("Reconnect voice")}</button>}
    </div>
    <HoldToTalk state={state} client={client} />
    <div id="voice-settings" className="voice-settings" role="region" aria-label={t('Audio and sharing settings')} hidden={!settingsOpen} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeSettings(); } }}>
      <h2>{t('Audio and sharing settings')}</h2>
      <button className="secondary-button" onClick={closeSettings}>{t('Close settings')}</button>
      <VoiceUsabilitySettings state={state} client={client} />
      <MediaQualitySettings state={state} change={(source, level) => void client.quality(source, level)} />
      <ReceivingSettings state={state} client={client} />
      <label className="voice-screen-audio"><input type="checkbox" checked={screenAudio} disabled={state.sharing || state.changingMedia || !state.canShareScreen} onChange={event => setScreenAudio(event.target.checked)} />{t('Include screen audio when available')}</label>
    {!navigator.mediaDevices?.getDisplayMedia && <p className="field-hint">{t('Screen capture is unavailable in this browser. You can still watch shared screens.')}</p>}
    {state.canSpeak && !state.canShareScreen && <p className="field-hint">{t('Screen sharing is not allowed in this room.')}</p>}
    {state.canSpeak && !state.canUseCamera && <p className="field-hint">{t('Camera sharing is not allowed in this room.')}</p>}
    <p className="field-hint">{t('Screen audio depends on your browser and chosen source. Camera and screen sharing stay off after reconnecting.')}</p>
    <label className="voice-volume">{t('Output volume')} <output>{state.volume}%</output><input aria-label={t('Output volume')} type="range" min="0" max="100" step="1" value={state.volume} onChange={event => client.volume(Number(event.target.value))} /></label>
    <div className="voice-noise-settings"><label><input type="checkbox" checked={state.noiseSuppression}
      disabled={!connected || state.pushToTalk || !state.canSpeak || !state.noiseSuppressionSupported || state.changingAudio || state.changingNoiseSuppression}
      onChange={event => void client.noiseSuppression(event.target.checked)} />{t('Noise suppression')}</label>
      <p className="field-hint">{t('Reduces background noise from your microphone using browser processing. Results depend on your browser and device.')}</p>
      <p className="field-hint">{t('Changing this setting may briefly interrupt your microphone.')}</p>
      <p className="field-hint" role="status">{t(!state.noiseSuppressionSupported ? 'Noise suppression is unavailable in this browser.' : state.changingNoiseSuppression ? 'Applying noise suppression…' : state.noiseSuppressionApplied === null ? 'Applies when you enable your microphone.' : state.noiseSuppressionApplied ? 'Noise suppression is on for this microphone.' : 'Noise suppression is off for this microphone.')}</p>
      {settingsOpen && state.noiseSuppressionError && <div role="alert"><p>{t(state.noiseSuppressionError)}</p>{state.noiseSuppressionError !== 'Microphone refresh failed. Your microphone is muted. Enable it to try again.' && <button className="secondary-button"
        disabled={!connected || state.pushToTalk || !state.canSpeak || state.changingAudio || state.changingNoiseSuppression}
        onClick={() => void client.noiseSuppression(state.noiseSuppression)}>{t('Retry noise suppression')}</button>}</div>}
    </div>
    <details className="voice-device-settings"><summary>{t("Media devices")}</summary><div className="voice-devices"><label>{t("Microphone")}<select aria-label={t("Microphone device")} disabled={!connected || state.pushToTalk || !!state.changingQuality} value={state.input} onChange={event => void client.device('audioinput', event.target.value)}><option value="default">{t("System default")}</option>{state.devices.filter(item => item.kind === 'audioinput' && item.deviceId !== 'default').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || t("Microphone {value}", { value: i + 1 })}</option>)}</select></label>
      <label>{t("Speaker")}<select aria-label={t("Speaker device")} disabled={!connected || !!state.changingQuality || !('setSinkId' in HTMLMediaElement.prototype)} value={state.output} onChange={event => void client.device('audiooutput', event.target.value)}><option value="default">{t("System default")}</option>{state.devices.filter(item => item.kind === 'audiooutput' && item.deviceId !== 'default').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || t("Speaker {value}", { value: i + 1 })}</option>)}</select></label><label>{t('Camera')}<select aria-label={t('Camera device')} disabled={!connected || !!state.changingQuality || state.camera || state.changingMedia} value={state.cameraDevice} onChange={event => client.cameraDevice(event.target.value)}><option value="default">{t('System default')}</option>{state.devices.filter(item => item.kind === 'videoinput').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || t('Camera {value}', { value: i + 1 })}</option>)}</select></label></div></details>
    </div>
    {state.mediaError && <div role="alert"><p>{t(state.mediaError)}</p><button className="secondary-button" onClick={() => client.clearMediaError()}>{t('Dismiss media notice')}</button></div>}
    {connected && state.playbackBlocked && <div className="voice-playback-notice"><p role="status">{t('Your browser blocked other participants’ audio. Allow playback to hear them. This does not play your own microphone.')}</p><button className="primary-button" disabled={state.startingPlayback} onClick={() => void client.playback()}>{t(state.startingPlayback ? 'Starting playback…' : 'Allow audio playback')}</button></div>}
    {!settingsOpen && state.noiseSuppressionError && <p role="alert">{t(state.noiseSuppressionError)}</p>}
    {state.error && <p role="alert" className="form-error">{t(state.error)}</p>}
  </section>;
}

export function PersistentVoiceVideo() {
  const client = useVoiceClient();
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  return <VoiceVideoPanel key={`${state.community ?? ''}:${state.status === 'Connected'}`} state={state} stop={video => void client.media(video.source, false)} receive={(id, enabled) => client.receiveVideo(id, enabled)} />;
}
