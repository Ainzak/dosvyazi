import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, CalendarDays, Plus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../accounts/useSession';
import { useI18n } from '../../i18n/LocaleContext';
import { getCommunity } from '../../api/communities';
import { ApiError } from '../../api/http';
import { gatheringKeys, getGathering, listGatherings, gatheringNotices, seenGatheringNotice } from '../../api/gatherings';
import type { Gathering } from '../../api/gatherings';
import { GatheringPlanForm } from './GatheringPlanForm';
import { GatheringDetail } from './GatheringDetail';
import { GatheringCounts, GatheringStatus, GatheringTime } from './GatheringSummary';
import { useGatheringLive } from './useGatheringLive';

const denied = (error: Error | null) => error instanceof ApiError && [401,403,404].includes(error.status);
export function GatheringsPage() {
  const { id = '', gatheringId } = useParams(); const session = useSession(); const { t } = useI18n();
  const community = useQuery({ queryKey: [...gatheringKeys(session.data?.id ?? '', id), 'parent-community'], queryFn: ({ signal }) => getCommunity(id, signal), enabled: !!session.data, refetchInterval: 5000 });
  if (session.isPending) return <p role="status">{t('Checking your session…')}</p>;
  if (session.isError) return <p role="alert">{t(session.error.message)}</p>;
  if (!session.data) return <section className="about-panel"><h1>{t('Sign in to view gatherings.')}</h1><Link to="/login">{t('Sign in')}</Link></section>;
  if (denied(community.error)) return <section className="about-panel"><h1>{t('Community unavailable.')}</h1><Link to="/communities">{t('Your communities')}</Link></section>;
  if (!community.data) return <section className="about-panel">{community.isPending ? <p role="status">{t('Loading community…')}</p> : <><p role="alert">{t(community.error?.message ?? 'Community is unavailable.')}</p><button onClick={() => void community.refetch()}>{t('Try again')}</button></>}</section>;
  return <GatheringsWorkspace key={`${session.data.id}:${id}`} user={session.data.id} community={id} name={community.data.name} gatheringId={gatheringId ?? null} />;
}
function GatheringsWorkspace({ user, community, name, gatheringId }: { user: string; community: string; name: string; gatheringId: string | null }) {
  const { t, locale } = useI18n(); const client = useQueryClient(); const navigate = useNavigate(); const [creating, setCreating] = useState(false); const [noticeOffset, setNoticeOffset] = useState(0);
  const createButton = useRef<HTMLButtonElement>(null);
  const closeEditor = () => { setCreating(false); createButton.current?.focus(); };
  const key = gatheringKeys(user, community); const live = useGatheringLive(user, community);
  const list = useInfiniteQuery({ queryKey: [...key, 'list'], initialPageParam: 0, queryFn: ({ pageParam, signal }) => listGatherings(community, pageParam, signal), getNextPageParam: last => last.hasMore ? Number(last.nextOffset) : undefined, refetchInterval: 10000 });
  const notices = useQuery({ queryKey: [...key, 'notices', noticeOffset], queryFn: ({ signal }) => gatheringNotices(community, noticeOffset, signal), refetchInterval: 10000 });
  const detailKey = [...key, 'detail', gatheringId];
  const detail = useQuery({ queryKey: detailKey, queryFn: async ({ signal }) => {
    const next = await getGathering(community, gatheringId!, signal); const current = client.getQueryData<Gathering>(detailKey);
    return current && BigInt(current.version) > BigInt(next.version) ? current : next;
  }, enabled: !!gatheringId, refetchInterval: 5000 });
  const seen = useMutation({ mutationFn: (id: string) => seenGatheringNotice(community, id), onSuccess: () => client.invalidateQueries({ queryKey: key }) });
  const saved = async (g: Gathering) => { await client.cancelQueries({ queryKey: key }); client.setQueryData([...key, 'detail', g.id], g); setCreating(false); navigate(`/communities/${community}/gatherings/${g.id}`); await client.invalidateQueries({ queryKey: key }); };
  const label = (kind: string) => t(({ created: 'New gathering invitation', updated: 'Gathering updated', reconfirmation: 'Reconfirmation requested', response: 'New gathering response', comment: 'New gathering discussion', cancelled: 'Gathering cancelled', completed: 'Gathering completed', cover: 'Cover updated', membership: 'Participants changed', reminder: 'Gathering starts soon', capacity: 'Gathering place limit updated', place: 'Gathering places updated', poll: 'Gathering poll updated' } as Record<string,string>)[kind] ?? 'Gathering notification');
  const cards = denied(list.error) ? [] : list.data?.pages.flatMap(p => p.items) ?? [];
  return <div className="gatherings-page"><Link className="gathering-back" to={gatheringId ? `/communities/${community}/gatherings` : `/communities/${community}`}><ArrowLeft size={16} aria-hidden="true" />{t(gatheringId ? 'All gatherings' : 'Back to community')}</Link>
    {!gatheringId && <><div className="page-heading"><div><p className="eyebrow">{name}</p><h1>{t('Gatherings')}</h1></div><button ref={createButton} className="primary-button" aria-expanded={creating} aria-controls="gathering-create" onClick={() => creating ? closeEditor() : setCreating(true)}><Plus size={18} aria-hidden="true" />{t(creating ? 'Close editor' : 'New gathering')}</button></div>
      <p className="field-hint gathering-introduction">{t('Invite selected members to an activity. Invitations do not grant access to private text or voice channels.')}</p></>}
    {!['Live', 'Connecting…'].includes(live.status) && <div className="gathering-update-notice" role="status"><p>{t(live.status === 'Offline.' ? 'You are offline. Gathering changes will appear when your connection returns.' : 'Gathering updates may be delayed. Changes are checked automatically.')}</p>{live.status === 'Live updates unavailable.' && <button className="secondary-button" onClick={() => { void client.invalidateQueries({ queryKey: key }); live.reconnect(); }}>{t('Check for new updates')}</button>}</div>}
    {!gatheringId && creating && <section id="gathering-create" className="gathering-surface gathering-create" aria-labelledby="g-create-heading"><h2 id="g-create-heading">{t('Create gathering')}</h2><GatheringPlanForm user={user} community={community} saved={saved} cancel={closeEditor} /></section>}
    {!gatheringId && <div className="gathering-index"><section className="gathering-list" aria-labelledby="g-list-heading"><h2 id="g-list-heading">{t('Your gatherings')}</h2>{list.isPending && <p role="status">{t('Loading gatherings…')}</p>}{list.isError && <div className="gathering-surface"><p role="alert">{t(list.error.message)}</p><button className="secondary-button" onClick={() => void list.refetch()}>{t('Try again')}</button></div>}{cards.length === 0 && !list.isPending && !list.isError && <div className="gathering-empty gathering-surface"><CalendarDays size={32} aria-hidden="true" /><p>{t('No gatherings yet. Create one or wait for an invitation.')}</p></div>}
      <div className="gathering-cards">{cards.map(g => <article className="gathering-card gathering-surface" key={g.id}>
        <div className="gathering-card-heading"><CalendarDays size={22} aria-hidden="true" /><GatheringStatus state={g.status} /></div>
        <h3><Link to={`/communities/${community}/gatherings/${g.id}`}>{g.title}</Link></h3>{g.game && <p className="gathering-card-game">{t('Game')}: {g.game}</p>}
        <GatheringTime gathering={g} /><GatheringCounts gathering={g} />
        <Link className="secondary-button gathering-view" aria-label={t('View gathering: {value}', { value: g.title })} to={`/communities/${community}/gatherings/${g.id}`}>{t('View gathering')}<ArrowRight size={16} aria-hidden="true" /></Link>
      </article>)}</div>
      {list.hasNextPage && <button className="secondary-button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('More gatherings')}</button>}
    </section><aside className="gathering-notifications-column"><details className="gathering-surface gathering-notices" open><summary><Bell size={18} aria-hidden="true" />{t('Gathering notifications')}{!!notices.data?.items.some(n => !n.seen) && <span className="gathering-badge" aria-label={t('{value} unread notifications on this page', { value: notices.data.items.filter(n => !n.seen).length })}>{notices.data.items.filter(n => !n.seen).length}</span>}</summary>
      {notices.isPending && <p role="status">{t('Loading notifications…')}</p>}{notices.isError && <><p role="alert">{t(notices.error.message)}</p><button className="secondary-button" onClick={() => void notices.refetch()}>{t('Retry notifications')}</button></>}{notices.data?.items.length === 0 && !notices.isError && <p>{t('No gathering notifications.')}</p>}
      {!denied(notices.error) && <ul className="gathering-notice-list">{notices.data?.items.map(n => <li className={n.seen ? '' : 'is-unread'} key={n.id}><div><Link to={`/communities/${community}/gatherings/${n.gatheringId}`}>{label(n.kind)}</Link><small>{new Date(n.createdAt).toLocaleString(locale)} · {t('Plan revision')} {n.revision}</small></div>{!n.seen && <button className="secondary-button" disabled={seen.isPending} onClick={() => seen.mutate(n.id)}>{t('Mark notification read')}</button>}</li>)}</ul>}
      {noticeOffset > 0 && <button className="secondary-button" onClick={() => setNoticeOffset(Math.max(0, noticeOffset - 100))}>{t('Newer notifications')}</button>}{notices.data?.hasMore && <button className="secondary-button" onClick={() => setNoticeOffset(Number(notices.data!.nextOffset))}>{t('Older notifications')}</button>}{seen.isError && <p role="alert">{t(seen.error.message)}</p>}
    </details></aside></div>}
    {gatheringId && (denied(detail.error) ? <section className="gathering-surface"><h1>{t('Gathering unavailable.')}</h1><p>{t('You may no longer be invited or a community member.')}</p></section> : detail.data ? <GatheringDetail key={detail.data.id} gathering={detail.data} user={user} saved={saved} /> : detail.isPending ? <p role="status">{t('Loading gathering…')}</p> : <section className="gathering-surface"><p role="alert">{t(detail.error?.message ?? 'Gathering unavailable.')}</p><button className="secondary-button" onClick={() => void detail.refetch()}>{t('Try again')}</button></section>)}
  </div>;
}
