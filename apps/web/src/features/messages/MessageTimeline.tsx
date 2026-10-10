import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserProfile } from '../../api/accounts';
import { communityKeys } from '../../api/communities';
import { ApiError } from '../../api/http';
import { applyEvents, catchUp, history, mergeMessages, RecoveryRequired, sendMessage } from '../../api/messages';
import type { MessageSnapshot } from '../../api/messages';
import { MessageActions } from './MessageActions';

export function MessageTimeline({ community, channel, user, canSend = true, canManageMessages = false, sendDeniedBy = null }: { community: string; channel: string; user: UserProfile; canSend?: boolean; canManageMessages?: boolean; sendDeniedBy?: string | null }) {
  const client = useQueryClient();
  const [connectionState, setConnectionState] = useState('Connecting…');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [draft, setDraft] = useState('');
  const request = useRef({ content: '', id: crypto.randomUUID(), confirmed: false });
  const listElement = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  const olderPosition = useRef<{ height: number; top: number } | null>(null);
  const key = [...communityKeys(user.id, community), 'channel', channel, 'messages'];
  const feed = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    const previous = client.getQueryData<MessageSnapshot>(key);
    if (!previous) return history(community, channel, signal);
    try {
      let current = previous;
      for (;;) {
        const page = await catchUp(community, channel, current.watermark, signal);
        current = applyEvents(current, page);
        if (!page.hasMore) return current;
      }
    } catch (error) {
      if (error instanceof RecoveryRequired || (error instanceof ApiError && error.status === 409)) return history(community, channel, signal);
      throw error;
    }
  } });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queryKey = [...communityKeys(user.id, community), 'channel', channel, 'messages'];
    const refresh = () => { if (!disposed) void client.invalidateQueries({ queryKey }); };
    const connection = new HubConnectionBuilder().withUrl('/hubs/messages', {
      transport: HttpTransportType.WebSockets, skipNegotiation: true,
    }).withAutomaticReconnect([0, 1000, 3000, 5000]).configureLogging(LogLevel.None).build();
    const subscribe = async () => {
      await connection.invoke('Subscribe', community, channel);
      if (!disposed) { setConnectionState('Live'); refresh(); }
    };
    // Register before connecting. Hints never carry message bodies; HTTP recovery
    // rechecks access and merges by persistent ID, including after missed events.
    connection.on('ChannelChanged', refresh);
    connection.onreconnecting(() => { if (!disposed) setConnectionState('Reconnecting…'); });
    connection.onreconnected(() => void subscribe().catch(() => { if (!disposed) { setConnectionState('Live updates unavailable.'); refresh(); } }));
    connection.onclose(() => { if (!disposed) { setConnectionState(navigator.onLine ? 'Live updates unavailable.' : 'Offline.'); refresh(); } });
    const start = async () => {
      if (!navigator.onLine) { if (!disposed) setConnectionState('Offline.'); return; }
      try { await connection.start(); if (disposed) { await connection.stop(); return; } await subscribe(); }
      catch {
        await connection.stop();
        if (!disposed) { setConnectionState(navigator.onLine ? 'Reconnecting…' : 'Offline.'); refresh(); timer = setTimeout(() => void start(), 5000); }
      }
    };
    const offline = () => { clearTimeout(timer); setConnectionState('Offline.'); void connection.stop(); };
    const online = () => { clearTimeout(timer); void start(); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    void start();
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', online); void connection.stop(); };
  }, [channel, client, community, connectionAttempt, user.id]);

  const older = useMutation({ mutationFn: async () => {
    const first = feed.data?.messages[0]?.sequence;
    return history(community, channel, AbortSignal.timeout(8000), first);
  }, onSuccess: page => {
    const list = listElement.current;
    if (list) olderPosition.current = { height: list.scrollHeight, top: list.scrollTop };
    client.setQueryData<MessageSnapshot>(key, current => current ? {
      ...current, ...(BigInt(page.watermark) < BigInt(current.watermark) ? {} : { messages: mergeMessages(current.messages, page.messages, current.deletedVersions), hasOlder: page.hasOlder }),
    } : undefined);
  } });
  const send = useMutation({ mutationFn: (content: string) => {
    followLatest.current = true;
    if (request.current.confirmed || request.current.content !== content) request.current = { content, id: crypto.randomUUID(), confirmed: false };
    return sendMessage(community, channel, request.current.id, content);
  }, onSuccess: async () => {
    // Keep the acknowledged command identity until the next send. Resetting it
    // while the mutation awaits history could briefly show a second pending row.
    request.current.confirmed = true;
    setDraft('');
    await client.invalidateQueries({ queryKey: key });
  } });

  useLayoutEffect(() => {
    const list = listElement.current;
    if (!list) return;
    if (olderPosition.current) {
      list.scrollTop = olderPosition.current.top + list.scrollHeight - olderPosition.current.height;
      olderPosition.current = null;
    } else if (followLatest.current) list.scrollTop = list.scrollHeight;
  }, [feed.data, send.isPending, send.isError]);

  if (feed.error instanceof ApiError && [401, 403, 404].includes(feed.error.status)) return <div className="message-error"><h3>Channel unavailable.</h3><p>Access to this channel has changed.</p></div>;
  return <div className="message-timeline">
    <div className="connection-status"><span role="status">{connectionState}</span>{connectionState !== 'Live' && <button className="secondary-button" onClick={() => setConnectionAttempt(value => value + 1)}>Reconnect</button>}</div>
    <p className="field-hint">Live updates with automatic history recovery. Messages are plain text.</p>
    {feed.isPending && <p role="status">Loading messages…</p>}
    {feed.isError && <div className="message-error"><p role="alert">{feed.error.message}</p><button className="secondary-button" onClick={() => void feed.refetch()}>Retry history</button></div>}
    {feed.data?.hasOlder && <button className="secondary-button" onClick={() => older.mutate()} disabled={older.isPending}>{older.isPending ? 'Loading older messages…' : 'Load older messages'}</button>}
    {older.isError && <p role="alert">{older.error.message}</p>}
    {feed.data?.messages.length === 0 && <div className="empty-messages"><h3>Start the conversation.</h3><p>Send the first message to your community.</p></div>}
    <ol ref={listElement} className="message-list" aria-label="Messages" onScroll={event => {
      const list = event.currentTarget;
      followLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
    }}>{feed.data?.messages.map(message => <li key={message.id} data-message-id={message.id}>
      <div className="message-meta"><strong>{message.authorName}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('en')}</time></div>
      <p>{message.content}</p>
      {message.updatedAt && <small>Edited</small>}
      <MessageActions message={message} community={community} channel={channel} canEdit={canSend && message.authorId === user.id} canDelete={(canSend && message.authorId === user.id) || canManageMessages} refresh={async () => { await client.invalidateQueries({ queryKey: key }); }} />
    </li>)}{(send.isPending || send.isError) && !request.current.confirmed && !feed.data?.messages.some(message => message.authorId === user.id && message.clientMessageId === request.current.id) && <li className="pending-message"><strong>{user.displayName}</strong><p>{send.variables}</p><span>{send.isPending ? 'Sending…' : 'Not confirmed. Retry with the same text.'}</span></li>}</ol>
    {!canSend && <p role="status">Read only: {sendDeniedBy ?? 'SendMessage is not granted.'}</p>}
    {canSend && <form className="message-composer" onSubmit={event => { event.preventDefault(); send.mutate(draft); }}>
      <label htmlFor="message-content">Message</label><textarea id="message-content" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={3} required disabled={send.isPending} placeholder="Write to your community…" />
      {send.isError && <p role="alert" className="form-error">{send.error.message}</p>}
      <div className="composer-footer"><span className="field-hint">{draft.length} / 4000 · Stored when confirmed</span><button className="primary-button" disabled={send.isPending || !draft.trim()}>{send.isPending ? 'Sending…' : send.isError ? 'Retry send' : 'Send message'}</button></div>
    </form>}
  </div>;
}
