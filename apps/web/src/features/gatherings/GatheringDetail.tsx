import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { closeGathering, discussGathering, respondGathering, gatheringCoverUrl, gatheringKeys, gatheringRevisions, uploadGatheringCover, removeGatheringCover } from '../../api/gatherings';
import type { Gathering } from '../../api/gatherings';
import { useI18n } from '../../i18n/LocaleContext';
import { GatheringPlanForm } from './GatheringPlanForm';
import { gatheringStateLabel } from './labels';
import { ApiError } from '../../api/http';

const coverVersionConflict = (error: Error) => error instanceof ApiError && error.status === 409 && error.message === 'Gathering changed. Reload it before trying again.';

export function GatheringTime({ gathering }: { gathering: Gathering }) {
  const { t, locale } = useI18n(); const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <div className="gathering-time"><p>{t('Your local time')}: <time dateTime={gathering.startAt}>{new Date(gathering.startAt).toLocaleString(locale, { timeZone: zone, timeZoneName: 'short' })}</time> · {zone}</p><p>{t('Organizer time')}: {gathering.localStart.replace('T',' ')} · {gathering.timeZoneId}</p></div>;
}
function CoverEditor({ gathering: g, user, saved }: { gathering: Gathering; user: string; saved: (g: Gathering) => Promise<void> }) {
  const { t } = useI18n(); const client = useQueryClient(); const [file, setFile] = useState<File | null>(null); const [version, setVersion] = useState(g.version); const input = useRef<HTMLInputElement>(null);
  const command = useRef({ key: '', file: null as File | null, id: crypto.randomUUID() });
  const change = useMutation({ mutationFn: (value: { action: 'upload' | 'remove'; version: string; file: File | null }) => {
    const key = JSON.stringify({ action: value.action, version: value.version }); if (command.current.key !== key || command.current.file !== value.file) command.current = { key, file: value.file, id: crypto.randomUUID() };
    return value.action === 'remove' ? removeGatheringCover(g.communityId, g.id, { clientRequestId: command.current.id, expectedVersion: value.version }) : uploadGatheringCover(g.communityId, g.id, command.current.id, value.version, value.file!);
  }, onSuccess: async result => { setFile(null); setVersion(result.version); if (input.current) input.current.value = ''; command.current.key = ''; await saved(result); },
    onError: async error => { if (coverVersionConflict(error)) await client.invalidateQueries({ queryKey: [...gatheringKeys(user, g.communityId), 'detail', g.id] }); } });
  const conflict = change.isError && coverVersionConflict(change.error);
  return <div className="gathering-cover-editor"><h3>{t('Optional cover')}</h3><label htmlFor="g-cover">{t('PNG or JPEG cover')}</label><input ref={input} id="g-cover" type="file" accept=".png,.jpg,.jpeg" disabled={change.isPending} onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setVersion(g.version); change.reset(); }} />
    <p className="field-hint">{t('Up to 2 MiB and 2048 by 2048 pixels. Cover changes keep existing responses.')}</p>
    <div className="gathering-actions"><button className="secondary-button" disabled={!file || change.isPending || conflict} onClick={() => change.mutate({ action: 'upload', version, file })}>{t('Upload cover')}</button>{g.coverId && <button className="secondary-button" disabled={change.isPending || conflict} onClick={() => change.mutate({ action: 'remove', version: g.version, file: null })}>{t('Remove cover')}</button>}</div>
    {conflict ? <div className="gathering-change"><p role="alert">{t('The gathering changed while you were editing its cover. Check the latest details and cover above before trying again. Any selected file is kept.')}</p><button className="secondary-button" disabled={g.version === change.variables?.version} onClick={() => { setVersion(g.version); change.reset(); command.current.key = ''; }}>{t('I reviewed the latest cover')}</button></div>
      : change.isError && <><p role="alert">{t(change.error.message)}</p><button className="secondary-button" onClick={() => change.mutate(change.variables!)}>{t('Retry cover change')}</button></>}
  </div>;
}
export function GatheringDetail({ gathering: g, user, saved }: { gathering: Gathering; user: string; saved: (g: Gathering) => Promise<void> }) {
  const { t } = useI18n(); const [editing, setEditing] = useState<Gathering | null>(null); const [clarification, setClarification] = useState(''); const [discussion, setDiscussion] = useState(''); const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewedRevision, setReviewedRevision] = useState(Number(g.revision)); const changed = reviewedRevision !== Number(g.revision);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const intent = useRef({ key: '', id: crypto.randomUUID() });
  type Action = { kind: 'response'; state: string; comment: string; revision: number } | { kind: 'discussion'; text: string; revision: number } | { kind: 'status'; status: string; version: string };
  const action = useMutation({ mutationFn: (value: Action) => {
    const key = JSON.stringify(value); if (intent.current.key !== key) intent.current = { key, id: crypto.randomUUID() };
    if (value.kind === 'response') return respondGathering(g.communityId, g.id, { clientRequestId: intent.current.id, expectedRevision: value.revision, state: value.state, comment: value.comment });
    if (value.kind === 'discussion') return discussGathering(g.communityId, g.id, { clientRequestId: intent.current.id, expectedRevision: value.revision, text: value.text });
    return closeGathering(g.communityId, g.id, { clientRequestId: intent.current.id, expectedVersion: value.version, status: value.status });
  }, onSuccess: async result => { intent.current.key = ''; setClarification(''); setDiscussion(''); await saved(result); } });
  const revisions = useQuery({ queryKey: [...gatheringKeys(user, g.communityId), 'detail', g.id, 'revisions', g.revision], queryFn: ({ signal }) => gatheringRevisions(g.communityId, g.id, signal), enabled: historyOpen });
  return <article className="gathering-detail about-panel"><h2>{g.title}</h2><p>{t(g.status)} · {t('Plan revision')} {g.revision}</p><p>{t('Organizer')}: <Link to={`/profiles/${g.organizerId}`}>{g.organizerName}</Link>{g.canManage && g.organizerId !== user && <> · {t('Community moderation access')}</>}</p>
    <GatheringTime gathering={g} />{g.game && <p>{t('Game')}: {g.game}</p>}{g.description && <p className="gathering-description">{g.description}</p>}
    {g.coverId && <img className="gathering-cover" src={gatheringCoverUrl(g.communityId, g.id, g.coverId)} alt={t('Gathering cover')} />}
    <div className="gathering-counts">{['Pending','Accepted','Declined','NeedsClarification'].map(state => <span key={state}>{t(gatheringStateLabel(state))}: {g.invites.filter(i => i.state === state).length}</span>)}</div>
    {changed && g.status === 'Scheduled' && <div className="gathering-change" role="status"><p>{t('The schedule or game changed. Review this plan before responding again.')}</p><button className="secondary-button" onClick={() => { setReviewedRevision(Number(g.revision)); action.reset(); }}>{t('Review updated plan')}</button></div>}
    <h3>{t('Participants')}</h3><ul className="management-list">{g.invites.map(i => <li key={i.userId}><Link to={`/profiles/${i.userId}`}>{i.name}</Link><span>{t(gatheringStateLabel(i.state))}{!i.currentMember && <> · {t('No longer a member')}</>}</span></li>)}</ul>
    {g.canRespond && <section><h3>{t('Your response')}</h3><div className="gathering-actions">{['Accepted','Declined'].map(state => <button className="secondary-button" key={state} disabled={action.isPending || changed} onClick={() => action.mutate({ kind: 'response', state, comment: '', revision: reviewedRevision })}>{t(state === 'Accepted' ? 'Accept gathering' : 'Decline gathering')}</button>)}</div>
      <form className="gathering-form" onSubmit={event => { event.preventDefault(); action.mutate({ kind: 'response', state: 'NeedsClarification', comment: clarification, revision: reviewedRevision }); }}><label htmlFor="g-clarification">{t('Clarification request')}</label><textarea id="g-clarification" required rows={2} maxLength={2000} value={clarification} onChange={event => setClarification(event.target.value)} disabled={action.isPending} /><button className="secondary-button" disabled={action.isPending || changed || !clarification.trim()}>{t('Request clarification')}</button></form>
    </section>}
    <h3>{t('Discussion')}</h3>{g.comments.length === 0 && <p>{t('No discussion yet.')}</p>}<ol className="gathering-discussion">{g.comments.map(c => <li key={c.id}><Link to={`/profiles/${c.authorId}`}>{c.authorName}</Link> · {t('Plan revision')} {c.revision}<p>{c.text}</p></li>)}</ol>
    {g.status === 'Scheduled' && <form className="gathering-form" onSubmit={event => { event.preventDefault(); action.mutate({ kind: 'discussion', text: discussion, revision: reviewedRevision }); }}><label htmlFor="g-discussion">{t('Discussion comment')}</label><textarea id="g-discussion" required rows={2} maxLength={2000} value={discussion} onChange={event => setDiscussion(event.target.value)} disabled={action.isPending} /><p className="field-hint">{t('Discussion comments keep your current response. Use Request clarification to ask for a change instead.')}</p><button className="secondary-button" disabled={action.isPending || changed || !discussion.trim()}>{t('Add discussion comment')}</button></form>}
    {g.status !== 'Scheduled' && <p role="status">{t('This gathering is closed. Responses and changes are disabled.')}</p>}
    {action.isError && <><p role="alert">{t(action.error.message)}</p><button className="secondary-button" onClick={() => action.mutate(action.variables!)} disabled={action.isPending}>{t('Retry gathering action')}</button><button className="secondary-button" onClick={() => action.reset()}>{t('Review updated plan')}</button></>}
    {g.canManage && g.status === 'Scheduled' && <section><div className="gathering-actions"><button className="secondary-button" onClick={() => setEditing(value => value ? null : g)}>{t(editing ? 'Close editor' : 'Edit gathering')}</button><button className="secondary-button" disabled={action.isPending} onClick={() => action.mutate({ kind: 'status', status: 'Cancelled', version: g.version })}>{t('Cancel gathering')}</button><button className="secondary-button" disabled={action.isPending || new Date(g.startAt).getTime() > now} onClick={() => action.mutate({ kind: 'status', status: 'Completed', version: g.version })}>{t('Mark gathering complete')}</button></div>
      {editing && <GatheringPlanForm user={user} community={g.communityId} initial={editing} saved={async result => { setEditing(null); setReviewedRevision(Number(result.revision)); await saved(result); }} cancel={() => setEditing(null)} />}
      <CoverEditor gathering={g} user={user} saved={saved} />
    </section>}
    <section className="gathering-history"><h3>{t('Schedule change history')}</h3><p className="field-hint">{t('View earlier dates, games and participant responses before the schedule changed.')}</p><button className="secondary-button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>{t(historyOpen ? 'Hide schedule changes' : 'View schedule changes')}</button>
      {historyOpen && <div>{revisions.isPending && <p role="status">{t('Loading previous plans…')}</p>}{revisions.isError && <p role="alert">{t(revisions.error.message)}</p>}{revisions.data?.length === 0 && <p>{t('No previous schedule revisions.')}</p>}{revisions.data?.map(r => <div className="gathering-previous" key={Number(r.revision)}><h4>{t('Plan revision')} {r.revision}</h4><HistoricalPlan plan={r.planJson} responses={r.responsesJson} /></div>)}</div>}
    </section>
  </article>;
}
function HistoricalPlan({ plan, responses }: { plan: string; responses: string }) {
  const { t, locale } = useI18n();
  let parsed: { value: { Title: string; Game: string; StartAt: string; TimeZoneId: string }; states: { State: string }[] } | null = null;
  try { parsed = { value: JSON.parse(plan), states: JSON.parse(responses) }; } catch { /* A damaged historical record must not hide the current plan. */ }
  if (!parsed) return <p>{t('Previous plan is unavailable.')}</p>;
  const { value, states } = parsed;
  return <><p>{value.Title} · {value.Game} · {new Date(value.StartAt).toLocaleString(locale)} · {t('Organizer zone')}: {value.TimeZoneId}</p><p>{['Pending','Accepted','Declined','NeedsClarification'].map(state => `${t(gatheringStateLabel(state))}: ${states.filter(s => s.State === state).length}`).join(' · ')}</p></>;
}
