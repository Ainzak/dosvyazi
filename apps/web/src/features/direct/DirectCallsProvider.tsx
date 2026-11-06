import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Phone } from 'lucide-react';
import { acceptCall, currentCalls, endCall, startCall } from '../../api/directCalls';
import type { DirectCall } from '../../api/directCalls';
import { useSession } from '../accounts/useSession';
import { useVoiceClient } from '../voice/VoiceContext';
import { useI18n } from '../../i18n/LocaleContext';
import { DirectCallContext, useDirectCalls } from './DirectCallContext';

export function DirectCallsProvider({ children }: { children: ReactNode }) {
  const session = useSession(); const user = session.data?.id; const cache = useQueryClient(); const voice = useVoiceClient();
  const state = useSyncExternalStore(voice.subscribe, voice.snapshot);
  const expected = useRef<string | null>(null), command = useRef({ conversation: '', id: crypto.randomUUID() });
  const key = ['private', user, 'calls'];
  const calls = useQuery({ queryKey: key, queryFn: ({ signal }) => currentCalls(signal), enabled: !!user, refetchInterval: user ? 2000 : false, retry: false });
  const refresh = () => cache.invalidateQueries({ queryKey: key });
  const join = (call: DirectCall) => { if (!voice.snapshot().community && !voice.snapshot().call && call.canJoin) void voice.joinDirect(call.id, call.conversationId, call.otherName); };
  const start = useMutation({ mutationFn: (conversation: string) => {
    if (command.current.conversation !== conversation) command.current = { conversation, id: crypto.randomUUID() };
    return startCall(conversation, command.current.id);
  }, onSuccess: call => { expected.current = call.id; command.current = { conversation: '', id: crypto.randomUUID() }; void refresh(); } });
  const answer = useMutation({ mutationFn: (call: DirectCall) => acceptCall(call.id), onSuccess: call => { join(call); void refresh(); } });
  const end = useMutation({ mutationFn: async (call: DirectCall) => {
    if (voice.snapshot().call === call.id) await voice.leave(); else await endCall(call.id);
  }, onSuccess: () => { expected.current = null; void refresh(); } });
  useEffect(() => { expected.current = null; }, [user]);
  useEffect(() => {
    const call = calls.data?.find(call => call.id === expected.current && call.status === 'Active' && call.canJoin);
    if (call && !state.community && !state.call) {
      expected.current = null; void voice.joinDirect(call.id, call.conversationId, call.otherName);
    }
  }, [calls.data, state.community, state.call, voice]);
  const error = start.error ?? answer.error ?? end.error ?? ((calls.data?.length || state.call) ? calls.error : null);
  return <DirectCallContext.Provider value={{ user, calls: calls.data ?? [], busy: start.isPending || answer.isPending || end.isPending, error: error?.message ?? null,
    start: conversation => { answer.reset(); end.reset(); start.mutate(conversation); }, answer: call => { start.reset(); end.reset(); answer.mutate(call); },
    end: call => { start.reset(); answer.reset(); end.mutate(call); }, join }}>{children}</DirectCallContext.Provider>;
}

export function DirectCallButton({ conversation, disabled }: { conversation: string; disabled: boolean }) {
  const { t } = useI18n(); const calls = useDirectCalls(); const voice = useVoiceClient(); const state = useSyncExternalStore(voice.subscribe, voice.snapshot);
  const existing = calls.calls.find(call => call.conversationId === conversation);
  return <button type="button" className="secondary-button" aria-label={t('Start personal call')} disabled={disabled || calls.busy || !!state.community || !!state.call || !!existing} onClick={() => calls.start(conversation)}><Phone size={18} aria-hidden="true" />{t('Call')}</button>;
}

export function DirectCallNotices() {
  const { t } = useI18n(); const calls = useDirectCalls(); const voice = useVoiceClient(); const state = useSyncExternalStore(voice.subscribe, voice.snapshot);
  if (!calls.user) return null;
  return <div className="direct-call-notices">{calls.error && <p className="form-error" role="alert">{t(calls.error)}</p>}{calls.calls.filter(call => call.id !== state.call).map(call => {
    const outgoing = call.callerId === calls.user; const ringing = call.status === 'Ringing';
    return <section key={call.id} className="direct-call-notice" aria-label={t(ringing ? outgoing ? 'Outgoing call' : 'Incoming call' : 'Personal call')}><div><strong>{call.otherName}</strong><p role="status">{t(ringing ? outgoing ? 'Calling…' : 'Incoming personal call' : call.canJoin ? 'Call ready. Join with your microphone muted.' : 'This call was answered on another device.')}</p><Link to={`/messages/${call.conversationId}`}>{t('Open conversation')}</Link></div><div className="settings-actions">
      {ringing && !outgoing && <button className="primary-button" disabled={calls.busy || !!state.community || !!state.call} onClick={() => calls.answer(call)}>{t('Answer call')}</button>}
      {!ringing && call.canJoin && <button className="primary-button" disabled={calls.busy || !!state.community || !!state.call} onClick={() => calls.join(call)}>{t('Join call')}</button>}
      <button className="secondary-button" disabled={calls.busy} onClick={() => calls.end(call)}>{t(ringing ? outgoing ? 'Cancel call' : 'Decline call' : 'End call')}</button>
    </div>{state.community && <p className="field-hint">{t('Leave your voice channel before answering a personal call.')}</p>}</section>;
  })}</div>;
}
