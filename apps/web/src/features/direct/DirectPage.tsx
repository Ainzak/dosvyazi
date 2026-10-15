import { StickerPicker } from '../stickers/StickerPicker';
import * as stickers from '../../api/stickers';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router';
import * as api from '../../api/direct';
import { ApiError } from '../../api/http';
import type { UserProfile } from '../../api/accounts';
import { useSession } from '../accounts/useSession';
import { useI18n } from '../../i18n/LocaleContext';
import { AttachmentDownload } from '../messages/AttachmentDownload';
import { VoiceRecorder } from '../messages/VoiceRecorder';
import { VoiceMessagePlayer } from '../messages/VoiceMessagePlayer';

function targetId(value: string) {
  const guid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  if (guid.test(value.trim())) return value.trim();
  try { const url = new URL(value, location.origin); const id = url.pathname.match(/^\/profiles\/([^/]+)\/?$/)?.[1]; if (url.origin === location.origin && id && guid.test(id)) return id; } catch { /* Validate without navigating to untrusted links. */ }
  throw new Error('Paste a Dosvyazi profile link or user ID.');
}

function StartConversation({ user, target }: { user: string; target?: string | undefined }) {
  const { t } = useI18n(); const navigate = useNavigate(); const cache = useQueryClient(); const [profile, setProfile] = useState(target ?? '');
  const command = useRef({ target: '', id: crypto.randomUUID() });
  const start = useMutation({ mutationFn: (value: string) => { const id = targetId(value); if (id.toLowerCase() === user.toLowerCase()) throw new Error('You cannot start a conversation with yourself.'); if (command.current.target !== id) command.current = { target: id, id: crypto.randomUUID() }; return api.startConversation(id, command.current.id); },
    onSuccess: result => { void cache.invalidateQueries({ queryKey: api.directKeys(user) }); navigate(`/messages/${result.id}`, { replace: !!target }); } });
  const automatic = useRef(false);
  useEffect(() => { if (target && !automatic.current) { automatic.current = true; start.mutate(target); } }, [target, start]);
  return <form className="direct-start" onSubmit={event => { event.preventDefault(); start.mutate(profile); }}>
    <label htmlFor="direct-profile">{t('Profile link or user ID')}</label><input id="direct-profile" value={profile} onChange={event => setProfile(event.target.value)} required maxLength={500} disabled={start.isPending} />
    <p className="field-hint">{t('Open someone’s profile and select Message, or paste their profile link here. Any signed-in user can start a conversation.')}</p>
    <button className="primary-button" disabled={start.isPending}>{t(start.isPending ? 'Opening conversation…' : 'Start conversation')}</button>
    {start.isError && <p role="alert">{t(start.error.message)}</p>}
  </form>;
}

export function DirectPage() {
  const session = useSession(); const { t } = useI18n(); const { id } = useParams(); const [search] = useSearchParams();
  if (session.isPending) return <p role="status">{t('Checking your session…')}</p>;
  if (session.isError) return <p role="alert">{t(session.error.message)}</p>;
  if (!session.data) return <section className="account-card"><h1>{t('Sign in to use direct messages.')}</h1><Link to="/login">{t('Sign in')}</Link></section>;
  return <DirectWorkspace key={session.data.id} user={session.data} id={id} target={search.get('to') ?? undefined} />;
}

function DirectWorkspace({ user, id, target }: { user: UserProfile; id?: string | undefined; target?: string | undefined }) {
  const { t } = useI18n(); const cache = useQueryClient(); const [before, setBefore] = useState<string | undefined>(); const [retry, setRetry] = useState(0); const [updates, setUpdates] = useState('');
  const keys = api.directKeys(user.id);
  const inbox = useQuery({ queryKey: [...keys, 'inbox', before], queryFn: ({ signal }) => api.inbox(signal, before), refetchInterval: 5000 });
  useEffect(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const connection = new HubConnectionBuilder().withUrl('/hubs/direct-messages', { transport: HttpTransportType.WebSockets, skipNegotiation: true }).withAutomaticReconnect([0, 1000, 3000, 5000]).configureLogging(LogLevel.None).build();
    const refresh = () => { if (!disposed) void cache.invalidateQueries({ queryKey: api.directKeys(user.id) }); };
    const subscribe = async () => { await connection.invoke('Subscribe', id ?? null); if (!disposed) { setUpdates(''); refresh(); } };
    connection.on('DirectChanged', refresh);
    connection.onreconnecting(() => { if (!disposed) setUpdates('Message updates are interrupted. Reconnecting automatically…'); });
    connection.onreconnected(() => void subscribe().catch(() => { if (!disposed) setUpdates('Message updates are paused. Check for new messages.'); }));
    connection.onclose(() => { if (!disposed) { setUpdates(navigator.onLine ? 'Message updates are paused. Check for new messages.' : 'You are offline. New messages will appear when you reconnect.'); refresh(); } });
    const start = async () => {
      if (!navigator.onLine) { if (!disposed) setUpdates('You are offline. New messages will appear when you reconnect.'); return; }
      try { await connection.start(); if (disposed) { await connection.stop(); return; } await subscribe(); }
      catch { await connection.stop(); if (!disposed) { setUpdates('Message updates are interrupted. Reconnecting automatically…'); refresh(); timer = setTimeout(() => void start(), 5000); } }
    };
    const online = () => { clearTimeout(timer); void start(); }; const offline = () => { clearTimeout(timer); setUpdates('You are offline. New messages will appear when you reconnect.'); void connection.stop(); };
    window.addEventListener('online', online); window.addEventListener('offline', offline); void start();
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); void connection.stop(); };
  }, [cache, user.id, id, retry]);
  return <><h1>{t('Direct messages')}</h1><p className="field-hint">{t('Conversations belong to their two participants. Community owners and moderators cannot access them.')}</p>
    {updates && <div role="status"><p>{t(updates)}</p><button className="secondary-button" onClick={() => setRetry(value => value + 1)}>{t('Check for new messages')}</button></div>}
    <div className="direct-workspace"><aside className="direct-inbox" aria-label={t('Your conversations')}>
      <h2>{t('Your conversations')}</h2>
      {inbox.isPending && <p role="status">{t('Loading conversations…')}</p>}
      {inbox.isError && <><p role="alert">{t(inbox.error.message)}</p><button className="secondary-button" onClick={() => void inbox.refetch()}>{t('Try again')}</button></>}
      {inbox.data?.conversations.length === 0 && <p>{t('No conversations yet.')}</p>}
      <nav aria-label={t('Conversation list')}>{inbox.data?.conversations.map(conversation => <NavLink key={conversation.id} to={`/messages/${conversation.id}`}><span>{conversation.otherName}</span>{Number(conversation.unread) > 0 && <small>{t('{value} unread', { value: Number(conversation.unread) })}</small>}{conversation.contactUnavailable && <small>{t('Contact unavailable')}</small>}</NavLink>)}</nav>
      {before && <button className="secondary-button" onClick={() => setBefore(undefined)}>{t('Recent conversations')}</button>}
      {inbox.data?.hasMore && <button className="secondary-button" onClick={() => setBefore(inbox.data!.before ?? undefined)}>{t('Older conversations')}</button>}
      <StartConversation key={`${user.id}:${target ?? ''}`} user={user.id} target={target} />
    </aside>{id ? <DirectThread key={`${user.id}:${id}`} user={user} id={id} /> : <section className="about-panel"><h2>{t('Choose a conversation')}</h2><p>{t('Start from a profile or open an existing conversation.')}</p></section>}</div></>;
}

function DirectActions({ message, id, refresh, editable }: { message: api.DirectMessage; id: string; refresh: () => void; editable: boolean }) {
  const { t } = useI18n(); const [mode, setMode] = useState<'edit' | 'delete' | null>(null); const [draft, setDraft] = useState(message.content);
  const command = useRef({ payload: '', id: crypto.randomUUID() }); const version = useRef(message.version);
  const change = useMutation({ mutationFn: () => { const payload = JSON.stringify({ mode, draft, version: version.current }); if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() };
    return mode === 'delete' ? api.remove(id, message.id, command.current.id, version.current) : api.edit(id, message.id, command.current.id, version.current, draft); }, onSuccess: () => { setMode(null); refresh(); } });
  return <div className="message-actions">
    {!mode && <>{editable && <button className="secondary-button" onClick={() => { setMode('edit'); setDraft(message.content); version.current = message.version; change.reset(); }}>{t('Edit')}</button>}<button className="secondary-button" onClick={() => { setMode('delete'); version.current = message.version; change.reset(); }}>{t('Delete')}</button></>}
    {mode === 'edit' && <form onSubmit={event => { event.preventDefault(); change.mutate(); }}><label>{t('Edit message')}<textarea aria-label={t('Edit direct message text')} value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} required disabled={change.isPending} /></label><button className="primary-button" disabled={change.isPending || !draft.trim() || !editable}>{t('Save message')}</button></form>}
    {mode === 'delete' && <><p>{t('Delete this message?')}</p><button className="secondary-button" disabled={change.isPending} onClick={() => change.mutate()}>{t('Confirm delete')}</button></>}
    {mode && <button className="secondary-button" disabled={change.isPending} onClick={() => setMode(null)}>{t('Cancel change')}</button>}
    {change.isError && <p role="alert">{t(change.error.message)}</p>}
  </div>;
}

function DirectThread({ user, id }: { user: UserProfile; id: string }) {
  const { t, locale } = useI18n(); const cache = useQueryClient(); const keys = api.directKeys(user.id); const key = [...keys, id, 'messages'];
  const [draft, setDraft] = useState(''); const [sticker, setSticker] = useState<stickers.Selection | null>(null); const [file, setFile] = useState<File | null>(null); const [voice, setVoice] = useState(false); const [recording, setRecording] = useState(false); const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null); const list = useRef<HTMLOListElement>(null); const follow = useRef(true); const position = useRef<{ height: number; top: number } | null>(null);
  const request = useRef({ content: '', file: null as File | null, sticker: null as string | null, id: crypto.randomUUID(), confirmed: false });
  const details = useQuery({ queryKey: [...keys, id, 'details'], queryFn: ({ signal }) => api.conversation(id, signal), refetchInterval: 5000 });
  const feed = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    let previous = cache.getQueryData<api.DirectSnapshot>(key); if (!previous) return api.history(id, signal);
    try { for (;;) { const page = await api.events(id, previous.watermark, signal); previous = api.applyDirect(previous, page); if (!page.hasMore) return previous; } }
    catch (error) { if (error instanceof ApiError && [401, 403, 404].includes(error.status)) throw error; return api.history(id, signal); }
  }, refetchInterval: 5000 });
  const refresh = () => { void cache.invalidateQueries({ queryKey: keys }); };
  const read = useMutation({ mutationFn: (sequence: string) => api.markRead(id, sequence), onSuccess: refresh });
  const blocking = useRef({ blocked: false, id: crypto.randomUUID(), initialized: false });
  const block = useMutation({ mutationFn: (blocked: boolean) => { if (!blocking.current.initialized || blocking.current.blocked !== blocked) blocking.current = { blocked, id: crypto.randomUUID(), initialized: true }; return api.block(id, blocking.current.id, blocked); }, onSuccess: result => { cache.setQueryData([...keys, id, 'details'], result); refresh(); } });
  const older = useMutation({ mutationFn: () => api.history(id, AbortSignal.timeout(8000), feed.data?.messages[0]?.sequence), onSuccess: page => {
    if (list.current) position.current = { height: list.current.scrollHeight, top: list.current.scrollTop };
    cache.setQueryData<api.DirectSnapshot>(key, current => current && BigInt(page.watermark) >= BigInt(current.watermark) ? { ...current, messages: api.mergeDirect(current.messages, page.messages, current.deletedVersions), hasOlder: page.hasOlder } : current);
  } });
  const send = useMutation({ mutationFn: (content: string) => { follow.current = true; if (request.current.confirmed || request.current.content !== content || request.current.file !== file || request.current.sticker !== (sticker?.id ?? null)) request.current = { content, file, sticker: sticker?.id ?? null, id: crypto.randomUUID(), confirmed: false };
    return sticker ? stickers.sendDirect(id, request.current.id, sticker.id, content) : file ? api.sendFile(id, request.current.id, content, file, voice) : api.send(id, request.current.id, content); }, onSuccess: () => { request.current.confirmed = true; setDraft(''); setSticker(null); setFile(null); setVoice(false); setFileError(null); if (fileInput.current) fileInput.current.value = ''; refresh(); } });
  useLayoutEffect(() => {
    const element = list.current; if (!element) return;
    if (position.current) { element.scrollTop = position.current.top + element.scrollHeight - position.current.height; position.current = null; }
    else if (follow.current) element.scrollTop = element.scrollHeight;
  }, [feed.data, send.isPending, send.isError]);
  if ([details.error, feed.error].some(error => error instanceof ApiError && [401, 403, 404].includes(error.status))) return <section className="about-panel"><h2>{t('Conversation is unavailable.')}</h2><p>{t('Sign in again or choose another conversation.')}</p></section>;
  const allowed = !!details.data && !details.data.contactUnavailable;
  return <section className="direct-thread" aria-label={t('Direct conversation')}><header><h2>{details.data?.otherName ?? t('Loading conversation…')}</h2>{details.data && <Link to={`/profiles/${details.data.otherUserId}`}>{t('View profile')}</Link>}</header>
    {details.isError && <p role="alert">{t(details.error.message)}</p>}
    {details.data && <><p>{t('{value} unread', { value: Number(details.data.unread) })}</p><button className="secondary-button" disabled={read.isPending || !feed.data} onClick={() => read.mutate(feed.data!.watermark)}>{t('Mark as read')}</button>
      <button className="secondary-button" disabled={block.isPending} onClick={() => block.mutate(!details.data!.blockedByMe)}>{t(details.data.blockedByMe ? 'Unblock direct contact' : 'Block direct contact')}</button></>}
    <p className="field-hint">{t('Blocking prevents messages and attachments in both directions. Earlier history remains available.')}</p>
    {[read.error, block.error].map((error, index) => error && <p key={index} role="alert">{t(error.message)}</p>)}
    {details.data?.contactUnavailable && <p role="status">{t('Contact is unavailable. You can still read earlier messages.')}</p>}
    {feed.isPending && <p role="status">{t('Loading messages…')}</p>}{feed.isError && <><p role="alert">{t(feed.error.message)}</p><button className="secondary-button" onClick={() => void feed.refetch()}>{t('Retry history')}</button></>}
    {feed.data?.hasOlder && <button className="secondary-button" disabled={older.isPending} onClick={() => older.mutate()}>{t(older.isPending ? 'Loading older messages…' : 'Load older messages')}</button>}{older.isError && <p role="alert">{t(older.error.message)}</p>}
    {feed.data?.messages.length === 0 && <p>{t('No messages yet. Say hello.')}</p>}
    <ol ref={list} className="message-list" aria-label={t('Direct messages')} onScroll={event => { const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64; }}>
      {feed.data?.messages.map(message => <li key={message.id} data-message-id={message.id}><div className="message-meta"><Link to={`/profiles/${message.authorId}`}><strong>{message.authorName}</strong></Link><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(locale)}</time></div><p className="direct-message-content">{message.content}</p>
        {message.attachment && <>{message.attachment.kind === 'Voice' && <VoiceMessagePlayer url={api.attachmentUrl(id, message.attachment.id)} duration={Number(message.attachment.durationMs)} />}<AttachmentDownload attachment={message.attachment} url={api.attachmentUrl(id, message.attachment.id)} /></>}
        {message.updatedAt && <small>{t('Edited')}</small>}{message.authorId === user.id && <DirectActions message={message} id={id} refresh={refresh} editable={allowed} />}
      </li>)}
      {(send.isPending || send.isError) && !request.current.confirmed && !feed.data?.messages.some(message => message.authorId === user.id && message.clientMessageId === request.current.id) && <li className="pending-message"><strong>{user.displayName}</strong><p>{send.variables}</p><span>{t(send.isPending ? 'Sending…' : 'Not confirmed. Retry with the same text.')}</span></li>}
    </ol>
    {allowed && <form className="message-composer" onSubmit={event => { event.preventDefault(); if (!recording) send.mutate(draft); }}><label htmlFor="direct-content">{t('Direct message')}</label><textarea id="direct-content" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} required={!file && !sticker} disabled={send.isPending} rows={3} placeholder={t('Write a direct message…')} />
      <StickerPicker user={user.id} selected={sticker} disabled={send.isPending || recording} pick={next => { setSticker(next); if (next) { setFile(null); setFileError(null); setVoice(false); if (fileInput.current) fileInput.current.value = ''; } }} />
      <VoiceRecorder file={voice ? file : null} disabled={send.isPending || !!sticker || (!!file && !voice)} busy={setRecording} ready={next => { setFile(next); setSticker(null); setVoice(!!next); setFileError(null); if (fileInput.current) fileInput.current.value = ''; }} />
      <label htmlFor="direct-file">{t('Attach a file')}</label><input ref={fileInput} id="direct-file" type="file" accept=".txt,.png,.jpg,.jpeg,.gif,.pdf" disabled={send.isPending || recording || voice} onChange={event => { const next = event.currentTarget.files?.[0] ?? null; const valid = !next || (next.size > 0 && next.size <= 5 * 1024 * 1024 && /\.(txt|png|jpe?g|gif|pdf)$/i.test(next.name)); setFile(valid ? next : null); setSticker(null); setVoice(false); setFileError(valid ? null : 'Choose a nonempty TXT, PNG, JPEG, GIF or PDF file up to 5 MiB.'); }} />
      {!voice && (file || fileError) && <button type="button" className="secondary-button" disabled={send.isPending} onClick={() => { setFile(null); setFileError(null); if (fileInput.current) fileInput.current.value = ''; }}>{t('Remove selected file')}</button>}
      {fileError && <p role="alert">{t(fileError)}</p>}{send.isError && <p role="alert">{t(send.error.message)}</p>}
      <button className="primary-button" disabled={send.isPending || recording || !!fileError || (!draft.trim() && !file && !sticker)}>{t(send.isPending ? 'Sending…' : send.isError ? 'Retry send' : 'Send direct message')}</button>
    </form>}
  </section>;
}
