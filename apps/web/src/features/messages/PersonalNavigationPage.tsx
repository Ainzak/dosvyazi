import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/navigation';
import { useSession } from '../accounts/useSession';
import { useI18n } from '../../i18n/LocaleContext';
import { BookmarkButton } from './NavigationTools';

export function PersonalNavigationPage({ notices = false }: { notices?: boolean }) {
  const session = useSession(); const { t } = useI18n();
  if (session.isPending) return <p role="status">{t('Checking your session…')}</p>;
  if (session.error) return <p role="alert">{t(session.error.message)}</p>;
  if (!session.data) return <Link to="/login">{t('Sign in')}</Link>;
  return notices ? <Notices key={session.data.id} user={session.data.id} /> : <Bookmarks key={session.data.id} user={session.data.id} />;
}
function Bookmarks({ user }: { user: string }) {
  const { t } = useI18n(); const [tag, setTag] = useState(''); const [query, setQuery] = useState(''); const [filter, setFilter] = useState({ tag: '', query: '' }); const [before, setBefore] = useState('');
  const data = useQuery({ queryKey: [...api.navigationKeys(user), 'bookmarks', filter, before], queryFn: ({ signal }) => api.bookmarks(signal, filter.tag, filter.query, before) });
  return <section className="personal-navigation"><h1>{t('Bookmarks')}</h1><p>{t('Private notes and tags. Sources disappear when deleted or when you lose access.')}</p><form className="bookmark-filters" onSubmit={e => { e.preventDefault(); setFilter({ tag: tag.trim(), query: query.trim() }); setBefore(''); }}><label>{t('Filter by tag')}<input aria-label={t('Filter by tag')} value={tag} maxLength={24} onChange={e => setTag(e.target.value)} /></label><label>{t('Search private notes')}<input aria-label={t('Search private notes')} value={query} maxLength={100} onChange={e => setQuery(e.target.value)} /></label><button className="secondary-button">{t('Search bookmarks')}</button></form>
    {data.isPending && <p role="status">{t('Loading…')}</p>}{data.error && <p role="alert">{t(data.error.message)}</p>}{!data.isError && data.data && <>{data.data.items.length === 0 && <p>{t('No bookmarks found.')}</p>}<ul className="personal-navigation-list">{data.data.items.map(item => <li key={item.id}><h2>{item.source ? <Link to={item.source.href}>{item.source.authorName}</Link> : t('Message source is unavailable.')}</h2>{item.source && <p>{item.source.content || t('Attachment message')}</p>}<p>{item.note}</p><p className="bookmark-tags">{item.tags.map(tag => <span key={tag}>#{tag} </span>)}</p><BookmarkButton scope={{ user, kind: item.kind as api.Scope['kind'], container: item.containerId }} message={item.messageId} existing={item} /></li>)}</ul>{data.data.hasMore && <button className="secondary-button" onClick={() => setBefore(data.data!.before ?? '')}>{t('Older bookmarks')}</button>}</>}{before && <button className="secondary-button" onClick={() => setBefore('')}>{t('Recent bookmarks')}</button>}
  </section>;
}
function Notices({ user }: { user: string }) {
  const { t } = useI18n(); const cache = useQueryClient(); const [before, setBefore] = useState(''); const commands = useRef(new Map<string, string>());
  const key = [...api.navigationKeys(user), 'notices']; const data = useQuery({ queryKey: [...key, before], queryFn: ({ signal }) => api.notices(signal, before), refetchInterval: 8000 });
  const read = useMutation({ mutationFn: (id: string) => { if (!commands.current.has(id)) commands.current.set(id, crypto.randomUUID()); return api.readNotice(id, commands.current.get(id)!); }, onSuccess: () => cache.invalidateQueries({ queryKey: key }) });
  return <section className="personal-navigation"><h1>{t('Notifications')}</h1><p>{t('New messages according to your conversation settings. Only sources you can still access are shown.')}</p>{data.isPending && <p role="status">{t('Loading…')}</p>}{data.error && <p role="alert">{t(data.error.message)}</p>}{read.error && <p role="alert">{t(read.error.message)}</p>}{!data.isError && data.data && <>{data.data.items.length === 0 && <p>{t('No new notifications on this page.')}</p>}<ul className="personal-navigation-list">{data.data.items.map(item => <li key={item.id}><small>{t(item.mention ? 'Mention or reply' : 'New message')}</small><h2><Link to={item.source.href}>{item.source.authorName}</Link></h2><p>{item.source.content || t('Attachment message')}</p><button className="secondary-button" disabled={read.isPending} onClick={() => read.mutate(item.id)}>{t('Dismiss notification')}</button></li>)}</ul>{data.data.hasMore && <button className="secondary-button" onClick={() => setBefore(data.data!.before ?? '')}>{t('Older notifications')}</button>}</>}{before && <button className="secondary-button" onClick={() => setBefore('')}>{t('Recent notifications')}</button>}</section>;
}
