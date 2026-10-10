import { useSyncExternalStore } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { disconnectVoice, getVoice } from '../../api/voice';
import { communityKeys } from '../../api/communities';
import { useVoiceClient } from './VoiceContext';

export function VoicePanel({ community, name, user, canView = true }: { community: string; name: string; user: string; canView?: boolean }) {
  const client = useVoiceClient();
  const voice = useSyncExternalStore(client.subscribe, client.snapshot);
  const query = useQuery({ queryKey: [...communityKeys(user, community), 'voice'], queryFn: ({ signal }) => getVoice(community, signal), refetchInterval: 4000, enabled: canView });
  const remove = useMutation({ mutationFn: (identity: string) => disconnectVoice(community, `${identity.slice(0, 8)}-${identity.slice(8, 12)}-${identity.slice(12, 16)}-${identity.slice(16, 20)}-${identity.slice(20)}`), onSuccess: () => { void query.refetch(); } });
  if (!canView) return <section className="voice-panel"><h2>Voice unavailable.</h2><p>You do not have access to this voice room.</p></section>;
  return <section className="voice-panel" aria-labelledby="voice-heading"><h2 id="voice-heading">Voice room</h2>
    <p className="field-hint">Members only. Join muted, then enable your microphone when ready.</p>
    {query.isPending ? <p role="status">Checking voice room…</p> : query.isError ? <><p role="alert">Voice is unavailable. {query.error.message}</p><button className="secondary-button" onClick={() => void query.refetch()}>Retry voice check</button></>
      : <><p role="status">{query.data.status === 'Pending' ? 'Access changes pending. Reconnecting members after confirmation.' : query.data.controlUnavailable ? 'Voice service is unavailable.' : query.data.participants.length === 0 ? 'No one is in voice yet.' : `${query.data.participants.length} in voice`}</p>
        {!query.data.canSpeak && <p>Listen only: {query.data.deniedBy}</p>}
        {!query.data.canConnect && <p>You cannot join: {query.data.deniedBy}</p>}
        <ul className="voice-participants">{query.data.participants.map(member => <li key={member.identity}>{member.displayName}{voice.speakers.includes(member.identity) && <span> · Speaking</span>}{query.data.canModerate && <button className="secondary-button" disabled={remove.isPending} aria-label={`Disconnect ${member.displayName}`} onClick={() => remove.mutate(member.identity)}>Disconnect</button>}</li>)}</ul></>}
    {remove.isError && <p role="alert">{remove.error.message}</p>}
    {voice.community === community ? <p>Use the voice controls below. You can keep reading text channels.</p>
      : <button className="primary-button" disabled={query.isPending || query.isError || !query.data?.canConnect || query.data?.status === 'Pending' || query.data?.controlUnavailable || !!voice.community}
        onClick={() => void client.join(community, name)}>Join voice</button>}
    {voice.community && voice.community !== community && <p>Leave your current voice room before joining here.</p>}
  </section>;
}

export function VoiceDock() {
  const client = useVoiceClient();
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  if (!state.community) return state.error ? <p className="voice-notice" role="alert">{state.error}</p> : null;
  const connected = state.status === 'Connected';
  return <section className="voice-dock" aria-label="Voice controls">
    <div><Link to={`/communities/${state.community}`}>{state.name} · Voice</Link><p role="status">{state.status}{state.muted ? ' · Muted' : ' · Microphone on'}{state.deafened ? ' · Deafened' : ''}</p></div>
    {!state.canSpeak && <p>Listen only. SpeakVoice is denied.</p>}
    <div className="voice-actions"><button className="secondary-button" disabled={!connected || state.deafened || state.changingAudio || !state.canSpeak} onClick={() => void client.microphone(!state.muted)}>{state.muted ? 'Enable microphone' : 'Mute microphone'}</button>
      <button className="secondary-button" disabled={!connected || state.changingAudio} onClick={() => void client.deafen(!state.deafened)}>{state.deafened ? 'Undeafen' : 'Deafen'}</button>
      <button className="secondary-button" disabled={!connected} onClick={() => void client.playback()}>Enable playback</button>
      <button className="secondary-button" disabled={state.status === 'Joining' || state.status === 'Leaving'} onClick={() => void client.leave()}>{state.status === 'Leave not confirmed' ? 'Retry leave' : 'Leave voice'}</button>
      {!connected && !['Joining', 'Leaving', 'Access updating', 'Leave not confirmed'].includes(state.status) && <button className="secondary-button" onClick={() => void client.join(state.community!, state.name)}>Reconnect voice</button>}</div>
    <details className="voice-device-settings"><summary>Audio devices</summary><div className="voice-devices"><label>Microphone<select aria-label="Microphone device" disabled={!connected} value={state.input} onChange={event => void client.device('audioinput', event.target.value)}><option value="default">System default</option>{state.devices.filter(item => item.kind === 'audioinput' && item.deviceId !== 'default').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Microphone ${i + 1}`}</option>)}</select></label>
      <label>Speaker<select aria-label="Speaker device" disabled={!connected || !('setSinkId' in HTMLMediaElement.prototype)} value={state.output} onChange={event => void client.device('audiooutput', event.target.value)}><option value="default">System default</option>{state.devices.filter(item => item.kind === 'audiooutput' && item.deviceId !== 'default').map((device, i) => <option key={device.deviceId || i} value={device.deviceId}>{device.label || `Speaker ${i + 1}`}</option>)}</select></label></div></details>
    {state.error && <p role="alert" className="form-error">{state.error}</p>}
  </section>;
}
