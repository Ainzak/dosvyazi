import { HistoryWindowControls } from './HistoryWindowControls';
import { ThreadActions } from '../threads/ThreadActions';
import { listThreads, threadHref, threadKeys } from '../../api/threads';
import { ImageSendOptions } from './ImageSendOptions';
import { useHistoryWindow, captureMessageAnchor, restoreMessageAnchor } from './historyWindow';
import { SendHorizontal } from 'lucide-react';
import { sendOnEnter } from './composerKeyboard';
import { ComposerTools, MessageAvatar } from './ConversationUi';
import { StickerPicker, StickerSelection } from '../stickers/StickerPicker';
import * as stickers from '../../api/stickers';
import { useI18n } from '../../i18n/LocaleContext';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserProfile } from '../../api/accounts';
import { communityKeys } from '../../api/communities';
import { ApiError } from '../../api/http';
import { applyEvents, attachmentUrl, catchUp, history, mergeMessages, RecoveryRequired, sendMessage, sendAttachment } from '../../api/messages';
import type { MessageSnapshot } from '../../api/messages';
import { MessageActions } from './MessageActions';
import { AttachmentDownload } from './AttachmentDownload';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import { VoiceRecorder } from './VoiceRecorder';
import { MessageExtras, MessageReactions, MessageContent, EmojiPicker } from './Completeness';
import { Link } from 'react-router';
import { BookmarkButton, DraftReferences, FocusedMessage, MentionLabels, MentionPicker, NotificationPreference, ReplyReference } from './NavigationTools';
import { navigationKeys } from '../../api/navigation';
import type { Member } from '../../api/navigation';

export function MessageTimeline({ community, channel, user, canSend = true, canManageMessages = false, sendDeniedBy = null, threads = false }: { community: string; channel: string; user: UserProfile; canSend?: boolean; canManageMessages?: boolean; sendDeniedBy?: string | null; threads?: boolean }) {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const scope = { kind: 'channel' as const, container: channel, user: user.id };
  const [reply, setReply] = useState<{ id: string; authorName: string } | null>(null);
  const [mentions, setMentions] = useState<Member[]>([]);
  const [connectionState, setConnectionState] = useState('Connecting…');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [draft, setDraft] = useState(''); const [sticker, setSticker] = useState<stickers.Selection | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [voiceFile, setVoiceFile] = useState(false); const [recording, setRecording] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null); const [imageSelection, setImageSelection] = useState(0); const [imageProcessing, setImageProcessing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ content: string; id: string; confirmed: boolean; file: File | null; sticker: string | null; references: string }>({ content: '', id: crypto.randomUUID(), confirmed: false, file: null, sticker: null, references: '' });
  const listElement = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  const olderPosition = useRef<ReturnType<typeof captureMessageAnchor>>(null);
  const key = [...communityKeys(user.id, community), 'channel', channel, 'messages'];
  const feed = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    const previous = client.getQueryData<MessageSnapshot>(key);
    if (!previous) return history(community, channel, signal);
    try {
      let current = previous;
      for (;;) {
        const page = await catchUp(community, channel, current.watermark, signal);
        current = applyEvents(current, page);
        if (!page.hasMore) {
          // Pagination may have added history while recovery was in flight.
          // Preserve those rows and deletion tombstones when applying this result.
          const latest = client.getQueryData<MessageSnapshot>(key);
          if (!latest) return current;
          if (BigInt(latest.watermark) > BigInt(current.watermark)) return latest;
          const deletedVersions = { ...latest.deletedVersions, ...current.deletedVersions };
          return { ...current, messages: mergeMessages(latest.messages, current.messages, deletedVersions),
            deletedVersions, hasOlder: latest.hasOlder };
        }
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

  const historyWindow = useHistoryWindow(feed.data?.messages);
  const roots = historyWindow.messages.map(m => m.id).join(',');
  const branches = useQuery({ queryKey: [...threadKeys(user.id, community, channel), 'roots', roots], queryFn: ({ signal }) => listThreads(community, channel, signal, { roots }), enabled: threads && !!roots && !feed.isError, refetchInterval: 5000 });
  const older = useMutation({ mutationFn: async () => {
    const first = feed.data?.messages[0]?.sequence;
    return history(community, channel, AbortSignal.timeout(8000), first);
  }, onSuccess: page => {
    const list = listElement.current;
    if (list) olderPosition.current = captureMessageAnchor(list);
    client.setQueryData<MessageSnapshot>(key, current => current ? {
      ...current, ...(BigInt(page.watermark) < BigInt(current.watermark) ? {} : { messages: mergeMessages(current.messages, page.messages, current.deletedVersions), hasOlder: page.hasOlder }),
    } : undefined);
    historyWindow.first(page.messages[0]?.sequence);
  } });
  const send = useMutation({ mutationFn: (content: string) => {
    followLatest.current = true; historyWindow.latest();
    const options = { replyToId: reply?.id ?? null, mentionUserIds: mentions.map(m => m.id) }; const references = JSON.stringify(options);
    if (request.current.confirmed || request.current.content !== content || request.current.file !== file || request.current.sticker !== (sticker?.id ?? null) || request.current.references !== references) request.current = { content, id: crypto.randomUUID(), confirmed: false, file, sticker: sticker?.id ?? null, references };
    return sticker ? stickers.sendChannel(community, channel, request.current.id, sticker.id, content, options) : file ? sendAttachment(community, channel, request.current.id, content, file, voiceFile, options) : sendMessage(community, channel, request.current.id, content, options);
  }, onSuccess: async () => {
    // Keep the acknowledged command identity until the next send. Resetting it
    // while the mutation awaits history could briefly show a second pending row.
    request.current.confirmed = true;
    setDraft(''); setSticker(null); setReply(null); setMentions([]);
    setFile(null); setVoiceFile(false); setFileError(null); if (fileInput.current) fileInput.current.value = '';
    await client.invalidateQueries({ queryKey: key });
  } });

  useEffect(() => { if (feed.data) void client.invalidateQueries({ queryKey: [...navigationKeys(user.id), 'channel', channel, 'source'] }); }, [feed.data, client, user.id, channel]);

  useLayoutEffect(() => {
    const list = listElement.current;
    if (!list) return;
    if (olderPosition.current) {
      restoreMessageAnchor(list, olderPosition.current);
      olderPosition.current = null;
    } else if (followLatest.current) list.scrollTop = list.scrollHeight;
  }, [feed.data, send.isPending, send.isError]);

  if (feed.error instanceof ApiError && [401, 403, 404].includes(feed.error.status)) return <div className="message-error"><h3>{t("Channel unavailable.")}</h3><p>{t("Access to this channel has changed.")}</p></div>;
  return <div className="message-timeline">
    <div className={`connection-status${['Live', 'Connecting…'].includes(connectionState) ? ' is-quiet' : ''}`}><span role="status">{t(connectionState)}</span>{!['Live', 'Connecting…'].includes(connectionState) && <button className="secondary-button" onClick={() => setConnectionAttempt(value => value + 1)}>{t("Reconnect")}</button>}</div>

    {feed.data && <>{threads && <Link className="about-link channel-threads-link" to={threadHref(community, channel)}>{t('Message threads')}</Link>}<NotificationPreference scope={scope} /><FocusedMessage scope={scope} /><MessageExtras user={user.id} community={community} channel={channel} watermark={feed.data.watermark} /></>}
    {feed.isPending && <p role="status">{t("Loading messages…")}</p>}
    {feed.isError && <div className="message-error"><p role="alert">{t(feed.error.message)}</p><button className="secondary-button" onClick={() => void feed.refetch()}>{t("Retry history")}</button></div>}
    {feed.data?.hasOlder && <button className="secondary-button" onClick={() => older.mutate()} disabled={older.isPending}>{older.isPending ? t("Loading older messages…") : t("Load older messages")}</button>}
    {older.isError && <p role="alert">{t(older.error.message)}</p>}
    {feed.data?.messages.length === 0 && <div className="empty-messages"><h3>{t("Start the conversation.")}</h3><p>{t("Send the first message to your community.")}</p></div>}
    <HistoryWindowControls window={historyWindow} move={(action, latest = false) => { followLatest.current = latest; action(); requestAnimationFrame(() => { if (listElement.current) listElement.current.scrollTop = latest ? listElement.current.scrollHeight : 0; }); }} />
    <ol ref={listElement} className="message-list" aria-label={t("Messages")} onScroll={event => {
      const list = event.currentTarget;
      followLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
    }}>{historyWindow.messages.map((message, index) => <li aria-posinset={historyWindow.startIndex + index + 1} aria-setsize={historyWindow.total} className="message-row" key={message.id} data-message-id={message.id}><MessageAvatar name={message.authorName} user={message.authorId} /><div className="message-body">
      <div className="message-meta"><Link to={`/profiles/${message.authorId}`}><strong>{message.authorName}</strong></Link><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>
      {message.replyToId && <ReplyReference scope={scope} message={message.replyToId} />}<MentionLabels user={user.id} users={message.mentionUserIds} />
      <MessageContent content={message.content} community={community} user={user.id} />
      {message.attachment?.kind === 'Voice' && <VoiceMessagePlayer url={attachmentUrl(community, channel, message.attachment.id)} duration={Number(message.attachment.durationMs)} />}
      {message.attachment && <AttachmentDownload attachment={message.attachment} community={community} channel={channel} />}
      {message.updatedAt && <small>{t("Edited")}</small>}
      <MessageReactions message={message} user={user.id} community={community} channel={channel} canSend={canSend} />
      {threads && !branches.isError && branches.data?.threads.filter(branch => branch.rootMessageId === message.id).map(branch => <Link key={branch.id} className="about-link thread-badge" to={threadHref(community, channel, branch.id)}>{t(branch.archived ? 'Archived thread: {value}' : 'Thread: {value}', { value: branch.title })}{Number(branch.messageCount) > 0 && ` · ${t('{value} replies', { value: branch.messageCount })}`}{Number(branch.unread) > 0 && ` · ${t('{value} unread', { value: branch.unread })}`}</Link>)}
      <MessageActions message={message} community={community} channel={channel} canEdit={canSend && message.authorId === user.id} canDelete={(canSend && message.authorId === user.id) || canManageMessages} refresh={async () => { await client.invalidateQueries({ queryKey: key }); }} navigation={<>{threads && <ThreadActions user={user.id} community={community} parent={channel} root={message.id} existing={!branches.isError ? branches.data?.threads.find(branch => branch.rootMessageId === message.id) : undefined} canCreate={canSend && !branches.isPending && !branches.isError} />}{canSend && <button type="button" className="secondary-button" disabled={send.isPending} onClick={event => { setReply({ id: message.id, authorName: message.authorName }); event.currentTarget.closest('details')?.removeAttribute('open'); document.getElementById('message-content')?.focus(); }}>{t('Reply')}</button>}<BookmarkButton scope={scope} message={message.id} /></>} />
    </div></li>)}{(send.isPending || send.isError) && !request.current.confirmed && !feed.data?.messages.some(message => message.authorId === user.id && message.clientMessageId === request.current.id) && <li className="pending-message"><strong>{user.displayName}</strong><p>{send.variables}</p><span>{send.isPending ? t("Sending…") : t("Not confirmed. Retry with the same text.")}</span></li>}</ol>
    {!canSend && <p role="status">{t("Read only: ")}{t(sendDeniedBy ?? 'SendMessage is not granted.') }</p>}
    {canSend && <form className="message-composer" onSubmit={event => { event.preventDefault(); if (!recording && !imageProcessing && !send.isPending && !fileError && (draft.trim() || file || sticker)) send.mutate(draft); }}>
      <DraftReferences reply={reply} mentions={mentions} clearReply={() => setReply(null)} removeMention={id => setMentions(values => values.filter(v => v.id !== id))} disabled={send.isPending} />
      <label className="sr-only" htmlFor="message-content">{t("Message")}</label><div className="composer-input-row"><textarea aria-describedby="message-content-help" onKeyDown={sendOnEnter} id="message-content" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={2} required={!file && !sticker} disabled={send.isPending} placeholder={t("Write to your community…")} /><div className="composer-inline-tools">
      <MentionPicker scope={scope} selected={mentions} change={setMentions} disabled={send.isPending || recording} /><EmojiPicker community={community} user={user.id} disabled={send.isPending} pick={text => setDraft(value => (value + text).slice(0, 4000))} />
      <StickerPicker compact user={user.id} selected={sticker} disabled={send.isPending || recording} pick={next => { setSticker(next); if (next) { setFile(null); setFileError(null); setVoiceFile(false); if (fileInput.current) fileInput.current.value = ''; } }} />
      <ComposerTools recording={recording}><VoiceRecorder file={voiceFile ? file : null} disabled={send.isPending || !!sticker || (!!file && !voiceFile)} busy={setRecording} ready={next => { setFile(next); setSticker(null); setVoiceFile(!!next); setFileError(null); if (fileInput.current) fileInput.current.value = ''; }} />
      <label htmlFor="message-file">{t('Attach a file')}</label><input ref={fileInput} id="message-file" type="file" accept=".txt,.png,.jpg,.jpeg,.gif,.pdf" disabled={send.isPending || recording || voiceFile} onChange={event => {
        setImageSelection(value => value + 1); const next = event.currentTarget.files?.[0] ?? null;
        const valid = !next || (next.size > 0 && next.size <= 5 * 1024 * 1024 && /\.(txt|png|jpe?g|gif|pdf)$/i.test(next.name));
        setFile(valid ? next : null); setSticker(null); setVoiceFile(false); setFileError(valid ? null : 'Choose a nonempty TXT, PNG, JPEG, GIF or PDF file up to 5 MiB.');
      }} />
      <p className="field-hint">{t('One file per message, up to 5 MiB. View PNG/JPEG/GIF images in chat or download files separately.')}</p>
      {!voiceFile && (file || fileError) && <button type="button" className="secondary-button" disabled={send.isPending} onClick={() => { setFile(null); setVoiceFile(false); setFileError(null); if (fileInput.current) fileInput.current.value = ''; }}>{t('Remove selected file')}</button>}
      </ComposerTools><button className="primary-button composer-send" aria-label={t(send.isPending ? 'Sending…' : send.isError ? 'Retry send' : 'Send message')} title={t(send.isPending ? 'Sending…' : send.isError ? 'Retry send' : 'Send message')} disabled={send.isPending || recording || imageProcessing || !!fileError || (!draft.trim() && !file && !sticker)}><SendHorizontal size={19} aria-hidden="true" /></button></div></div><StickerSelection selected={sticker} disabled={send.isPending || recording} remove={() => setSticker(null)} />
      {fileError && <p role="alert">{t(fileError)}</p>}
      {file && !voiceFile && <ImageSendOptions key={imageSelection} file={file} busy={send.isPending || recording} choose={setFile} processing={setImageProcessing} />}
    {file && <p className="selected-attachment" role="status">{t(voiceFile ? 'Voice message preview' : 'Selected file: {value}', { value: file.name })}</p>}
      {send.isError && <p role="alert" className="form-error">{t(send.error.message)}</p>}
      <span className={draft.length >= 3600 ? "composer-count" : "sr-only"}>{draft.length} / 4000</span>
      <p id="message-content-help" className="composer-help sr-only">{t('Enter to send · Shift + Enter for a new line')}</p>
    </form>}
  </div>;
}
