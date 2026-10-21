import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/http';
import type { UserProfile } from '../../api/accounts';
import { communityKeys, getCommunity } from '../../api/communities';
import type { ChannelSummary } from '../../api/communities';
import { changeForumTopic, getForumTopic, listForumTopics, forumHref, forumKeys } from '../../api/forums';
import type { ForumTopic } from '../../api/forums';
import { useSession } from '../accounts/useSession';
import { useI18n } from '../../i18n/LocaleContext';
import { MessageTimeline } from '../messages/MessageTimeline';
import { CreateTopic } from './CreateTopic';

function TopicSettings({ initial, community, parent, user, close }: { initial: ForumTopic; community: string; parent: string; user: string; close: () => void }) {
  const { t } = useI18n(); const client = useQueryClient(); const [title, setTitle] = useState(initial.title); const [archived, setArchived] = useState(initial.archived);
  const command = useRef({ payload: '', id: crypto.randomUUID() });
  const save = useMutation({ mutationFn: () => { const payload = JSON.stringify({ title: title.trim(), archived, version: initial.version }); if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() }; return changeForumTopic(community, parent, initial.id, command.current.id, initial.version, title.trim(), archived); }, onSuccess: async result => {
    client.setQueryData([...forumKeys(user, community, parent), 'detail', result.id], result); await client.invalidateQueries({ queryKey: forumKeys(user, community, parent) }); close();
  } });
  return <form className="forum-settings about-panel" onSubmit={e => { e.preventDefault(); if (!save.isPending) save.mutate(); }}><h2>{t('Forum topic settings')}</h2><label>{t('Topic title')}<input required minLength={2} maxLength={80} value={title} onChange={e => setTitle(e.target.value)} disabled={save.isPending} /></label><label className="forum-checkbox"><input type="checkbox" checked={archived} disabled={save.isPending} onChange={e => setArchived(e.target.checked)} />{t('Archive forum topic (read only)')}</label><p className="field-hint">{t('Archiving keeps the history and stops new posts. Reopen the forum topic to continue.')}</p>{save.isError && <p role="alert">{t(save.error.message)} {t('Your settings draft is retained. Close it and reopen to review the latest saved version.')}</p>}<div className="settings-actions"><button className="primary-button" disabled={save.isPending || title.trim().length < 2}>{t('Save topic settings')}</button><button type="button" className="secondary-button" disabled={save.isPending} onClick={close}>{t('Close settings')}</button></div></form>;
}

function TopicConversation({ community, parent, topic, user, profile, channel }: { community: string; parent: string; topic: string; user: string; profile: UserProfile; channel: ChannelSummary }) {
  const { t } = useI18n(); const [settings, setSettings] = useState<ForumTopic>();
  const query = useQuery({ queryKey: [...forumKeys(user, community, parent), 'detail', topic], queryFn: ({ signal }) => getForumTopic(community, parent, topic, signal), refetchInterval: 3000 });
  if (query.isPending) return <p role="status">{t('Loading forum topic…')}</p>;
  if (!query.data || (query.error instanceof ApiError && [401, 403, 404].includes(query.error.status))) return <section className="about-panel"><h1>{t('Forum topic unavailable.')}</h1><p role="alert">{t(query.error?.message)}</p><button className="secondary-button" onClick={() => void query.refetch()}>{t('Try again')}</button></section>;
  const data = query.data;
  return <div className="forum-conversation"><div className="forum-heading"><div><p className="eyebrow">{t(data.archived ? 'Archived forum topic' : 'Forum topic')}</p><h1>{data.title}</h1><p className="field-hint">{t('Access follows this forum.')}</p></div>{data.canManage && !settings && <button className="secondary-button" onClick={() => setSettings(data)}>{t('Manage forum topic')}</button>}</div>
    {query.isError && <p role="alert">{t(query.error.message)} <button className="secondary-button" onClick={() => void query.refetch()}>{t('Try again')}</button></p>}
    {settings && data.canManage && <TopicSettings key={settings.version} initial={settings} community={community} parent={parent} user={user} close={() => setSettings(undefined)} />}
    <MessageTimeline key={data.id} community={community} channel={data.id} user={profile} canSend={data.canSend} canManageMessages={channel.canManageMessages ?? false} sendDeniedBy={data.archived ? 'This forum topic is archived. Reopen it to send messages.' : channel.sendDeniedBy ?? null} />
  </div>;
}

function TopicList({ community, parent, user, canCreate }: { community: string; parent: string; user: string; canCreate: boolean }) {
  const { t, locale } = useI18n(); const [archived, setArchived] = useState(false); const [before, setBefore] = useState<string>(); const [query, setQuery] = useState(''); const [term, setTerm] = useState('');
  const list = useQuery({ queryKey: [...forumKeys(user, community, parent), 'list', archived, before, term], queryFn: ({ signal }) => listForumTopics(community, parent, signal, { archived, ...(before ? { before } : {}), ...(term ? { query: term } : {}) }), refetchInterval: 5000 });
  return <section className="about-panel forum-directory"><h1>{t('Forum topics')}</h1>{canCreate && <CreateTopic community={community} forum={parent} user={user} />}<p>{t('Create a topic with a title and a first post. Each topic has its own conversation and follows this forum’s access rules.')}</p><form onSubmit={e => { e.preventDefault(); setBefore(undefined); setTerm(query.trim()); }}><label>{t('Search forum topic titles')}<input value={query} maxLength={80} onChange={e => setQuery(e.target.value)} /></label><button className="secondary-button">{t('Search')}</button></form><label className="forum-checkbox"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setBefore(undefined); }} />{t('Show archived topics')}</label>
    {list.isPending && <p role="status">{t('Loading forum topics…')}</p>}{list.isError && <p role="alert">{t(list.error.message)} <button className="secondary-button" onClick={() => void list.refetch()}>{t('Try again')}</button></p>}
    {!list.isError && list.data && <>{list.data.topics.length === 0 && <p>{t('No forum topics match this view.')}</p>}<ul className="management-list">{list.data.topics.map(item => <li key={item.id}><div><Link to={forumHref(community, parent, item.id)}>{item.title}</Link><span>{t('{value} messages', { value: item.messageCount })} · {new Date(item.createdAt).toLocaleDateString(locale)}</span></div>{Number(item.unread) > 0 && <strong>{t('{value} unread', { value: item.unread })}</strong>}</li>)}</ul><div className="settings-actions">{list.data.hasMore && <button className="secondary-button" onClick={() => setBefore(list.data.before ?? undefined)}>{t('Older topics')}</button>}{before && <button className="secondary-button" onClick={() => setBefore(undefined)}>{t('Newest topics')}</button>}</div></>}
  </section>;
}

function AuthorizedForum({ community, parent, topic, user, profile }: { community: string; parent: string; topic?: string | undefined; user: string; profile: UserProfile }) {
  const { t } = useI18n(); const details = useQuery({ queryKey: [...communityKeys(user, community), 'details'], queryFn: ({ signal }) => getCommunity(community, signal), refetchInterval: 3000 });
  if (details.isPending) return <p role="status">{t('Loading community…')}</p>;
  if (details.isError && !details.data && !(details.error instanceof ApiError && [401, 403, 404].includes(details.error.status))) return <section className="about-panel"><p role="alert">{t(details.error.message)}</p><button className="secondary-button" onClick={() => void details.refetch()}>{t('Try again')}</button></section>;
  const channel = details.data?.channels.find(c => c.id === parent && c.kind === "Forum");
  if (!channel || (details.error instanceof ApiError && [401, 403, 404].includes(details.error.status))) return <section className="about-panel"><h1>{t('Forum topic unavailable.')}</h1><p>{t('The forum may be hidden or unavailable.')}</p><Link to={`/communities/${community}`}>{t('Back to community')}</Link></section>;
  return <div className={`forum-page${topic ? ' has-conversation' : ''}`}><nav className="forum-navigation"><Link className="about-link" to={topic ? forumHref(community, parent) : `/communities/${community}`}>{topic ? t('Back to forum: {value}', { value: channel.name }) : t('Back to community')}</Link></nav>{details.isError && <p role="alert">{t(details.error.message)}</p>}{topic ? <TopicConversation key={topic} community={community} parent={parent} topic={topic} user={user} profile={profile} channel={channel} /> : <TopicList community={community} parent={parent} user={user} canCreate={channel.canSend ?? false} />}</div>;
}

export function ForumsPage() {
  const { t } = useI18n(); const session = useSession(); const { id, forumId, topicId } = useParams();
  if (session.isPending) return <p role="status">{t('Checking your session…')}</p>;
  if (session.isError && !session.data) return <section className="about-panel"><p role="alert">{t(session.error.message)}</p><button className="secondary-button" onClick={() => void session.refetch()}>{t('Try again')}</button></section>;
  if (!session.data) return <section className="about-panel"><h1>{t('Sign in to read forums.')}</h1><Link to="/login">{t('Sign in')}</Link></section>;
  return <AuthorizedForum key={`${session.data.id}:${id}:${forumId}`} community={id ?? ''} parent={forumId ?? ''} topic={topicId} user={session.data.id} profile={session.data} />;
}
