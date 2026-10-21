import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getChoices, gatheringKeys } from '../../api/gatherings';
import type { Choices, Gathering, Poll, PollOptionInput } from '../../api/gatherings';
import { ApiError, mutateApi } from '../../api/http';
import { useI18n } from '../../i18n/LocaleContext';

type Action = { path: string; body: Record<string, unknown>; kind: 'gathering' | 'choices' };
type PollDraft = { kind: string; options: string[]; zone: string; version: string };
export function GatheringChoices({ gathering: initial, user, saved }: { gathering: Gathering; user: string; saved: (g: Gathering) => Promise<void> }) {
  const { t } = useI18n(); const client = useQueryClient();
  const prefix = gatheringKeys(user, initial.communityId); const key = [...prefix, 'detail', initial.id, 'choices'];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => getChoices(initial.communityId, initial.id, signal), refetchInterval: 5000 });
  const root = `/api/v1/communities/${initial.communityId}/gatherings/${initial.id}`;
  const [capacity, setCapacity] = useState<{ value: string; version: string } | null>(null);
  const [draft, setDraft] = useState<PollDraft | null>(null); const receipt = useRef({ key: '', id: crypto.randomUUID() });
  const [decision, setDecision] = useState<{ poll: string; option: string; version: string; label: string } | null>(null); const dialog = useRef<HTMLDialogElement>(null);
  const change = useMutation({ mutationFn: async (a: Action) => {
    const fingerprint = JSON.stringify(a); if (receipt.current.key !== fingerprint) receipt.current = { key: fingerprint, id: crypto.randomUUID() };
    const body = { ...a.body, clientRequestId: receipt.current.id };
    const result = await mutateApi<Gathering | Choices>(root + a.path, a.path === '/polls' ? 'POST' : 'PUT', body);
    const g = a.kind === 'choices' ? (result as Choices).gathering : result as Gathering;
    await saved(g); await client.invalidateQueries({ queryKey: prefix }); return result;
  }, onSuccess: () => { receipt.current.key = ''; setCapacity(null); setDraft(null); }, onError: () => client.invalidateQueries({ queryKey: prefix }) });
  const data = query.data; const denied = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  if (!data || denied) return <section className="gathering-surface">{query.isError ? <><p role="alert">{t(query.error.message)}</p><button className="secondary-button" onClick={() => void query.refetch()}>{t('Try again')}</button></> : <p role="status">{t('Loading attendance choices…')}</p>}</section>;
  const g = data.gathering; const closed = g.status !== 'Scheduled'; const own = g.invites.find(i => i.userId === user);
  const confirmed = 1 + g.invites.filter(i => i.place === 'Confirmed').length;
  const run = (path: string, body: Record<string, unknown>, kind: Action['kind'] = 'gathering') => change.mutate({ path, body, kind });
  const conflict = change.error instanceof ApiError && change.error.status === 409;
  return <section className="gathering-surface gathering-choices" aria-labelledby="g-choices-heading"><h2 id="g-choices-heading">{t('Places and planning')}</h2>
    {query.isError && <p role="alert">{t(query.error.message)}</p>}
    <p>{t('Confirmed places: {value}', { value: confirmed })} · {g.capacity === null ? t('No place limit') : t('Place limit: {value}', { value: g.capacity! })}</p>
    <p className="field-hint">{t('The organizer has one place. Reserve participants are promoted manually, never automatically.')}</p>
    {own?.state === 'Accepted' && <p role="status" className={`gathering-place-status${own.place === 'Reserve' ? ' gathering-place-reserve' : ''}`}>{t(own.place === 'Confirmed' ? 'Your place is confirmed.' : 'You are in reserve. Wait for the organizer to confirm a place.')}</p>}
    <ul className="gathering-checklist">{g.invites.filter(i => i.state === 'Accepted').map(i => <li key={i.userId}><span>{i.name} · {t(i.place === 'Confirmed' ? 'Place confirmed' : 'In reserve')}</span>
      {g.canManage && !closed && <button className="secondary-button" disabled={change.isPending || !!capacity || !!draft} onClick={() => run('/seat', { expectedVersion: g.version, userId: i.userId, confirmed: i.place !== 'Confirmed' })}>{t(i.place === 'Confirmed' ? 'Move to reserve' : 'Confirm place')}</button>}</li>)}</ul>
    {g.canManage && !closed && <>{!capacity ? <button className="secondary-button" disabled={change.isPending} onClick={() => { change.reset(); setCapacity({ value: String(g.capacity ?? ''), version: g.version }); }}>{t('Change place limit')}</button> : <form className="gathering-form" onSubmit={e => { e.preventDefault(); if (!conflict) run('/capacity', { expectedVersion: capacity.version, capacity: capacity.value ? Number(capacity.value) : null }); }}>
      <label htmlFor="g-capacity">{t('Places including the organizer (blank for unlimited)')}</label><input id="g-capacity" type="number" min={1} max={51} value={capacity.value} disabled={change.isPending} onChange={e => setCapacity({ ...capacity, value: e.target.value })} />
      <div className="gathering-actions"><button className="primary-button" disabled={change.isPending || conflict}>{t('Save place limit')}</button><button type="button" className="secondary-button" disabled={change.isPending} onClick={() => { setCapacity(null); change.reset(); }}>{t('Close editor')}</button></div></form>}</>}
    <h3>{t('Time and game polls')}</h3><p className="field-hint">{t('Select every option that suits you. Voting never changes the plan: the organizer explicitly applies an option.')}</p>
    {!data.polls.length && <p>{t('No planning polls yet.')}</p>}
    {data.polls.map(p => <div className="gathering-poll" key={p.id}><PollBallot key={`${user}:${p.id}`} user={user} poll={p} gathering={g} root={root} updated={async result => { await saved(result.gathering); await client.invalidateQueries({ queryKey: prefix }); }} />
      {g.canManage && !closed && !p.closed && <div className="gathering-actions">{p.options.map(o => <button key={o.id} className="secondary-button" disabled={change.isPending} onClick={() => { setDecision({ poll: p.id, option: o.id, version: g.version, label: o.game || `${o.localStart.replace('T', ' ')} · ${o.timeZoneId}` }); dialog.current?.showModal(); }}>{t('Apply option {value}', { value: p.options.indexOf(o) + 1 })}</button>)}<button className="secondary-button" disabled={change.isPending} onClick={() => run(`/polls/${p.id}/decision`, { expectedVersion: g.version, action: 'close' }, 'choices')}>{t('Close poll without changes')}</button></div>}
    </div>)}
    {g.canManage && !closed && <>{!draft ? <button className="secondary-button" disabled={change.isPending || data.polls.length >= 10} onClick={() => { change.reset(); setDraft({ kind: 'Game', options: ['', ''], zone: Intl.DateTimeFormat().resolvedOptions().timeZone, version: g.version }); }}>{t('Create planning poll')}</button> : <form className="gathering-form" onSubmit={e => { e.preventDefault(); if (conflict) return; const options: PollOptionInput[] = draft.options.map(value => ({ game: draft.kind === 'Game' ? value : '', localStart: draft.kind === 'Time' ? value : '', timeZoneId: draft.zone })); run('/polls', { expectedVersion: draft.version, kind: draft.kind, options }, 'choices'); }}>
      <label htmlFor="g-poll-kind">{t('Poll type')}</label><select id="g-poll-kind" disabled={change.isPending} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value, options: ['', ''] })}><option value="Game">{t('Game options')}</option><option value="Time">{t('Time options')}</option></select>
      {draft.kind === 'Time' && <><label htmlFor="g-poll-zone">{t('Poll time zone')}</label><input id="g-poll-zone" maxLength={100} required value={draft.zone} disabled={change.isPending} onChange={e => setDraft({ ...draft, zone: e.target.value })} /></>}
      {draft.options.map((value, i) => <div key={i}><label htmlFor={`g-poll-${i}`}>{t('Option {value}', { value: i + 1 })}</label><input id={`g-poll-${i}`} type={draft.kind === 'Time' ? 'datetime-local' : 'text'} maxLength={80} required disabled={change.isPending} value={value} onChange={e => setDraft({ ...draft, options: draft.options.map((s, n) => n === i ? e.target.value : s) })} /></div>)}
      <div className="gathering-actions">{draft.options.length < 6 && <button type="button" className="secondary-button" disabled={change.isPending} onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })}>{t('Add poll option')}</button>}{draft.options.length > 2 && <button type="button" className="secondary-button" disabled={change.isPending} onClick={() => setDraft({ ...draft, options: draft.options.slice(0, -1) })}>{t('Remove last option')}</button>}<button className="primary-button" disabled={change.isPending || conflict}>{t('Save planning poll')}</button><button type="button" className="secondary-button" disabled={change.isPending} onClick={() => { setDraft(null); change.reset(); }}>{t('Close editor')}</button></div>
    </form>}</>}
    {change.isError && <div className="gathering-change"><p role="alert">{t(change.error.message)}</p>{conflict ? <button className="secondary-button" onClick={() => { if (capacity) setCapacity({ ...capacity, version: g.version }); if (draft) setDraft({ ...draft, version: g.version }); change.reset(); receipt.current.key = ''; }}>{t('I reviewed the latest attendance choices')}</button> : <button className="secondary-button" disabled={change.isPending} onClick={() => change.mutate(change.variables!)}>{t('Retry planning action')}</button>}</div>}
    <dialog ref={dialog} className="gathering-dialog" aria-labelledby="g-apply-heading"><h2 id="g-apply-heading">{t('Apply this option to the gathering?')}</h2><p>{decision?.label}</p><p>{t('A changed time or game asks participants to confirm again, clears readiness and disables reminders. Other open polls close. Votes alone never apply a change.')}</p><div className="gathering-actions"><button className="secondary-button" onClick={() => dialog.current?.close()}>{t('Keep current plan')}</button><button className="primary-button" onClick={() => { if (!decision) return; dialog.current?.close(); run(`/polls/${decision.poll}/decision`, { expectedVersion: decision.version, action: 'apply', optionId: decision.option }, 'choices'); }}>{t('Confirm selected option')}</button></div></dialog>
  </section>;
}
function PollBallot({ poll: p, gathering: g, user, root, updated }: { poll: Poll; gathering: Gathering; user: string; root: string; updated: (result: Choices) => Promise<void> }) {
  const { t, locale } = useI18n(); const client = useQueryClient(); const [selected, setSelected] = useState(p.myOptions); const [version, setVersion] = useState(p.voteVersion); const receipt = useRef({ key: '', id: crypto.randomUUID() });
  const vote = useMutation({ mutationFn: (options: string[]) => { const value = { expectedVersion: version, expectedRevision: p.revision, options }; const key = JSON.stringify(value); if (receipt.current.key !== key) receipt.current = { key, id: crypto.randomUUID() }; return mutateApi<Choices>(`${root}/polls/${p.id}/vote`, 'PUT', { ...value, clientRequestId: receipt.current.id }); },
    onSuccess: async data => { const own = data.polls.find(x => x.id === p.id)!; setVersion(own.voteVersion); setSelected(own.myOptions); receipt.current.key = ''; await updated(data); }, onError: () => client.invalidateQueries({ queryKey: gatheringKeys(user, g.communityId) }) });
  const changed = version !== p.voteVersion; const closed = p.closed || g.status !== 'Scheduled';
  return <form onSubmit={e => { e.preventDefault(); if (!closed && !changed && !vote.isPending) vote.mutate(selected); }}><h4>{t(p.kind === 'Time' ? 'Time options' : 'Game options')} · {t(closed ? 'Poll closed' : 'Poll open')}</h4>
    {p.options.map((o, i) => <label className="gathering-poll-option" key={o.id}><input type="checkbox" checked={selected.includes(o.id)} disabled={closed || vote.isPending || !(g.canRespond || g.organizerId === user)} onChange={e => setSelected(values => e.target.checked ? [...values, o.id] : values.filter(v => v !== o.id))} />
      <span>{i + 1}. {p.kind === 'Game' ? o.game : <>{o.localStart.replace('T', ' ')} · {o.timeZoneId}<small>{t('Your local time')}: {new Date(o.startAt!).toLocaleString(locale, { timeZoneName: 'short' })}</small></>}<small>{t('Votes: {value}', { value: o.votes })}{p.selectedOptionId === o.id && <> · {t('Applied to plan')}</>}</small></span></label>)}
    {!closed && (g.canRespond || g.organizerId === user) && <button className="secondary-button" disabled={vote.isPending || changed || vote.error instanceof ApiError && vote.error.status === 409} type="submit">{t('Save my vote')}</button>}
    {(changed || vote.error instanceof ApiError && vote.error.status === 409) && <button className="secondary-button" type="button" onClick={() => { setVersion(p.voteVersion); setSelected(p.myOptions); vote.reset(); receipt.current.key = ''; }}>{t('Review my latest vote')}</button>}
    {vote.isError && <p role="alert">{t(vote.error.message)}</p>}
  </form>;
}
