import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/http';
import type { UserProfile } from '../../api/accounts';
import { communityKeys, getCommunity } from '../../api/communities';
import type { ChannelSummary } from '../../api/communities';
import { changeThread, getThread, listThreads, threadHref, threadKeys } from '../../api/threads';
import type { Thread } from '../../api/threads';
import { useSession } from '../accounts/useSession';
import { useI18n } from '../../i18n/LocaleContext';
import { MessageTimeline } from '../messages/MessageTimeline';
import { ReplyReference } from '../messages/NavigationTools';

function ThreadSettings({ initial, community, parent, user, close }: { initial: Thread; community: string; parent: string; user: string; close: () => void }) {
  const { t } = useI18n(); const client = useQueryClient(); const [title, setTitle] = useState(initial.title); const [archived, setArchived] = useState(initial.archived);
  const command = useRef({ payload: '', id: crypto.randomUUID() });
  const save = useMutation({ mutationFn: () => { const payload = JSON.stringify({ title: title.trim(), archived, version: initial.version }); if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() }; return changeThread(community, parent, initial.id, command.current.id, initial.version, title.trim(), archived); }, onSuccess: async result => {
    client.setQueryData([...threadKeys(user, community, parent), 'detail', result.id], result); await client.invalidateQueries({ queryKey: threadKeys(user, community, parent) }); close();
  } });
  return <form className="thread-settings about-panel" onSubmit={e => { e.preventDefault(); if (!save.isPending) save.mutate(); }}><h2>{t('Message thread settings')}</h2><label>{t('Message thread title')}<input required minLength={2} maxLength={80} value={title} onChange={e => setTitle(e.target.value)} disabled={save.isPending} /></label><label className="thread-checkbox"><input type="checkbox" checked={archived} disabled={save.isPending} onChange={e => setArchived(e.target.checked)} />{t('Archive thread (read only)')}</label><p className="field-hint">{t('Archiving keeps the history and stops new messages. Reopen the thread to continue.')}</p>{save.isError && <p role="alert">{t(save.error.message)} {t('Your settings draft is retained. Close it and reopen to review the latest saved version.')}</p>}<div className="settings-actions"><button className="primary-button" disabled={save.isPending || title.trim().length < 2}>{t('Save thread settings')}</button><button type="button" className="secondary-button" disabled={save.isPending} onClick={close}>{t('Close settings')}</button></div></form>;
}

function ThreadConversation({ community, parent, thread, user, profile, channel }: { community: string; parent: string; thread: string; user: string; profile: UserProfile; channel: ChannelSummary }) {
  const { t } = useI18n(); const [settings, setSettings] = useState<Thread>();
  const query = useQuery({ queryKey: [...threadKeys(user, community, parent), 'detail', thread], queryFn: ({ signal }) => getThread(community, parent, thread, signal), refetchInterval: 3000 });
  if (query.isPending) return <p role="status">{t('Loading thread…')}</p>;
  if (!query.data || (query.error instanceof ApiError && [401, 403, 404].includes(query.error.status))) return <section className="about-panel"><h1>{t('Thread unavailable.')}</h1><p role="alert">{t(query.error?.message)}</p><button className="secondary-button" onClick={() => void query.refetch()}>{t('Try again')}</button></section>;
  const data = query.data;
  return <div className="thread-conversation"><div className="thread-heading"><div><p className="eyebrow">{t(data.archived ? 'Archived thread' : 'Message thread')}</p><h1>{data.title}</h1><p className="field-hint">{t('Access follows the parent channel.')}</p></div>{data.canManage && !settings && <button className="secondary-button" onClick={() => setSettings(data)}>{t('Manage message thread')}</button>}</div>
    {query.isError && <p role="alert">{t(query.error.message)} <button className="secondary-button" onClick={() => void query.refetch()}>{t('Try again')}</button></p>}
    {settings && data.canManage && <ThreadSettings key={settings.version} initial={settings} community={community} parent={parent} user={user} close={() => setSettings(undefined)} />}
    <details className="thread-source"><summary>{t('Original message')}</summary>{data.rootDeleted ? <p>{t('The original message was removed. The thread remains available to channel members.')}</p> : <ReplyReference scope={{ kind: 'channel', container: parent, user }} message={data.rootMessageId} />}</details>
    <MessageTimeline key={data.id} community={community} channel={data.id} user={profile} canSend={data.canSend} canManageMessages={channel.canManageMessages ?? false} sendDeniedBy={data.archived ? 'This thread is archived. Reopen it to send messages.' : channel.sendDeniedBy ?? null} />
  </div>;
}

function ThreadList({ community, parent, user }: { community: string; parent: string; user: string }) {
  const { t, locale } = useI18n(); const [archived, setArchived] = useState(false); const [before, setBefore] = useState<string>(); const [query, setQuery] = useState(''); const [term, setTerm] = useState('');
  const list = useQuery({ queryKey: [...threadKeys(user, community, parent), 'list', archived, before, term], queryFn: ({ signal }) => listThreads(community, parent, signal, { archived, ...(before ? { before } : {}), ...(term ? { query: term } : {}) }), refetchInterval: 5000 });
  return <section className="about-panel thread-directory"><h1>{t('Message threads')}</h1><p>{t('Open a thread from a message to keep a separate discussion. Threads share this channel’s access rules.')}</p><form onSubmit={e => { e.preventDefault(); setBefore(undefined); setTerm(query.trim()); }}><label>{t('Search thread titles')}<input value={query} maxLength={80} onChange={e => setQuery(e.target.value)} /></label><button className="secondary-button">{t('Search')}</button></form><label className="thread-checkbox"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setBefore(undefined); }} />{t('Show archived threads')}</label>
    {list.isPending && <p role="status">{t('Loading threads…')}</p>}{list.isError && <p role="alert">{t(list.error.message)} <button className="secondary-button" onClick={() => void list.refetch()}>{t('Try again')}</button></p>}
    {!list.isError && list.data && <>{list.data.threads.length === 0 && <p>{t('No threads match this view.')}</p>}<ul className="management-list">{list.data.threads.map(item => <li key={item.id}><div><Link to={threadHref(community, parent, item.id)}>{item.title}</Link><span>{t('{value} replies', { value: item.messageCount })} · {new Date(item.createdAt).toLocaleDateString(locale)}</span></div>{Number(item.unread) > 0 && <strong>{t('{value} unread', { value: item.unread })}</strong>}</li>)}</ul><div className="settings-actions">{list.data.hasMore && <button className="secondary-button" onClick={() => setBefore(list.data.before ?? undefined)}>{t('Older threads')}</button>}{before && <button className="secondary-button" onClick={() => setBefore(undefined)}>{t('Newest threads')}</button>}</div></>}
  </section>;
}

function AuthorizedThreads({ community, parent, thread, user, profile }: { community: string; parent: string; thread?: string | undefined; user: string; profile: UserProfile }) {
  const { t } = useI18n(); const details = useQuery({ queryKey: [...communityKeys(user, community), 'details'], queryFn: ({ signal }) => getCommunity(community, signal), refetchInterval: 3000 });
  if (details.isPending) return <p role="status">{t('Loading community…')}</p>;
  if (details.isError && !details.data && !(details.error instanceof ApiError && [401, 403, 404].includes(details.error.status))) return <section className="about-panel"><p role="alert">{t(details.error.message)}</p><button className="secondary-button" onClick={() => void details.refetch()}>{t('Try again')}</button></section>;
  const channel = details.data?.channels.find(c => c.id === parent);
  if (!channel || (details.error instanceof ApiError && [401, 403, 404].includes(details.error.status))) return <section className="about-panel"><h1>{t('Thread unavailable.')}</h1><p>{t('The parent channel may be hidden or unavailable.')}</p><Link to={`/communities/${community}`}>{t('Back to community')}</Link></section>;
  return <div className={`threads-page${thread ? ' has-conversation' : ''}`}><nav className="thread-navigation"><Link className="about-link" to={`/communities/${community}/channels/${parent}`}>{t('Back to #{value}', { value: channel.name })}</Link>{thread && <Link className="about-link" to={threadHref(community, parent)}>{t('All message threads')}</Link>}</nav>{details.isError && <p role="alert">{t(details.error.message)}</p>}{thread ? <ThreadConversation key={thread} community={community} parent={parent} thread={thread} user={user} profile={profile} channel={channel} /> : <ThreadList community={community} parent={parent} user={user} />}</div>;
}

export function ThreadsPage() {
  const { t } = useI18n(); const session = useSession(); const { id, channelId, threadId } = useParams();
  if (session.isPending) return <p role="status">{t('Checking your session…')}</p>;
  if (session.isError && !session.data) return <section className="about-panel"><p role="alert">{t(session.error.message)}</p><button className="secondary-button" onClick={() => void session.refetch()}>{t('Try again')}</button></section>;
  if (!session.data) return <section className="about-panel"><h1>{t('Sign in to read threads.')}</h1><Link to="/login">{t('Sign in')}</Link></section>;
  return <AuthorizedThreads key={`${session.data.id}:${id}:${channelId}`} community={id ?? ''} parent={channelId ?? ''} thread={threadId} user={session.data.id} profile={session.data} />;
}
