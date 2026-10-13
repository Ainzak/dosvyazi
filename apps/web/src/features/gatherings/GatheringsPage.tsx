import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../accounts/useSession';
import { useI18n } from '../../i18n/LocaleContext';
import { getCommunity } from '../../api/communities';
import { ApiError } from '../../api/http';
import { gatheringKeys, getGathering, listGatherings, gatheringNotices, seenGatheringNotice } from '../../api/gatherings';
import type { Gathering } from '../../api/gatherings';
import { GatheringPlanForm } from './GatheringPlanForm';
import { GatheringDetail, GatheringTime } from './GatheringDetail';
import { useGatheringLive } from './useGatheringLive';
import { gatheringStateLabel } from './labels';

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
  const label = (kind: string) => t(({ created: 'New gathering invitation', updated: 'Gathering updated', reconfirmation: 'Reconfirmation requested', response: 'New gathering response', comment: 'New gathering discussion', cancelled: 'Gathering cancelled', completed: 'Gathering completed', cover: 'Cover updated', membership: 'Participants changed' } as Record<string,string>)[kind] ?? 'Gathering notification');
  const cards = denied(list.error) ? [] : list.data?.pages.flatMap(p => p.items) ?? [];
  return <div className="gatherings-page"><Link to={`/communities/${community}`}>{t('Back to community')}</Link><div className="page-heading"><div><p className="eyebrow">{name}</p><h1>{t('Gatherings')}</h1></div><button className="primary-button" onClick={() => setCreating(value => !value)}>{t(creating ? 'Close editor' : 'New gathering')}</button></div>
    <p className="field-hint">{t('Invite selected members to an activity. Invitations do not grant access to private text or voice channels.')}</p>
    <div className="connection-status"><span role="status">{t(live.status)}</span>{live.status !== 'Live' && <button className="secondary-button" onClick={live.reconnect}>{t('Reconnect')}</button>}</div>
    {creating && <section className="about-panel"><h2>{t('Create gathering')}</h2><GatheringPlanForm user={user} community={community} saved={saved} cancel={() => setCreating(false)} /></section>}
    <details className="about-panel gathering-notices"><summary>{t('Gathering notifications')} <span aria-hidden="true">{notices.data?.items.filter(n => !n.seen).length ?? 0}</span></summary>
      {notices.isPending && <p role="status">{t('Loading notifications…')}</p>}{notices.isError && <p role="alert">{t(notices.error.message)}</p>}{notices.data?.items.length === 0 && <p>{t('No gathering notifications.')}</p>}
      {!denied(notices.error) && <ul className="management-list">{notices.data?.items.map(n => <li key={n.id}><div><Link to={`/communities/${community}/gatherings/${n.gatheringId}`}>{label(n.kind)}</Link><small>{new Date(n.createdAt).toLocaleString(locale)} · {t('Plan revision')} {n.revision}</small></div>{!n.seen && <button className="secondary-button" disabled={seen.isPending} onClick={() => seen.mutate(n.id)}>{t('Mark notification read')}</button>}</li>)}</ul>}
      {noticeOffset > 0 && <button className="secondary-button" onClick={() => setNoticeOffset(Math.max(0, noticeOffset - 100))}>{t('Newer notifications')}</button>}{notices.data?.hasMore && <button className="secondary-button" onClick={() => setNoticeOffset(Number(notices.data!.nextOffset))}>{t('Older notifications')}</button>}{seen.isError && <p role="alert">{t(seen.error.message)}</p>}
    </details>
    {gatheringId && (denied(detail.error) ? <section className="about-panel"><h2>{t('Gathering unavailable.')}</h2><p>{t('You may no longer be invited or a community member.')}</p><Link to={`/communities/${community}/gatherings`}>{t('All gatherings')}</Link></section> : detail.data ? <GatheringDetail key={detail.data.id} gathering={detail.data} user={user} saved={saved} /> : detail.isPending ? <p role="status">{t('Loading gathering…')}</p> : <section className="about-panel"><p role="alert">{t(detail.error?.message ?? 'Gathering unavailable.')}</p><button onClick={() => void detail.refetch()}>{t('Try again')}</button></section>)}
    <section className="gathering-list"><h2>{t('Your gatherings')}</h2>{list.isPending && <p role="status">{t('Loading gatherings…')}</p>}{list.isError && <><p role="alert">{t(list.error.message)}</p><button onClick={() => void list.refetch()}>{t('Try again')}</button></>}{cards.length === 0 && !list.isPending && <p>{t('No gatherings yet. Create one or wait for an invitation.')}</p>}
      {cards.map(g => <article className="about-panel" key={g.id}><h3><Link to={`/communities/${community}/gatherings/${g.id}`}>{g.title}</Link></h3><p>{t(g.status)} · {t('Plan revision')} {g.revision}</p><GatheringTime gathering={g} />{g.game && <p>{t('Game')}: {g.game}</p>}<div className="gathering-counts">{['Pending','Accepted','Declined','NeedsClarification'].map(state => <span key={state}>{t(gatheringStateLabel(state))}: {g.invites.filter(i => i.state === state).length}</span>)}</div></article>)}
      {list.hasNextPage && <button className="secondary-button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('More gatherings')}</button>}
    </section>
  </div>;
}
