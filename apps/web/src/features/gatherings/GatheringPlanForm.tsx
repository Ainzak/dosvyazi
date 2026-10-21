import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { gatheringKeys, gatheringCandidates, saveGathering } from '../../api/gatherings';
import type { Gathering, Plan } from '../../api/gatherings';
import { useI18n } from '../../i18n/LocaleContext';
import { Link } from 'react-router';

function tomorrow() { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(19, 0, 0, 0); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T19:00`; }
export function GatheringPlanForm({ user, community, initial, saved, cancel }: { user: string; community: string; initial?: Gathering; saved: (g: Gathering) => Promise<void>; cancel: () => void }) {
  const { t } = useI18n(); const [selected, setSelected] = useState(() => initial?.invites.filter(i => i.currentMember).map(i => i.userId) ?? []);
  const version = useRef(initial?.version ?? '0'); const command = useRef({ payload: '', id: crypto.randomUUID() });
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => { titleInput.current?.focus(); }, []);
  const candidates = useInfiniteQuery({ queryKey: [...gatheringKeys(user, community), 'candidates'], initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => gatheringCandidates(community, pageParam, signal), getNextPageParam: last => last.hasMore ? Number(last.nextOffset) : undefined });
  const choices = [...new Map([...(initial?.invites.filter(i => i.currentMember).map(i => ({ id: i.userId, name: i.name })) ?? []), ...(candidates.data?.pages.flatMap(p => p.items) ?? [])].map(i => [i.id, i])).values()].filter(i => i.id !== initial?.organizerId);
  const submit = useMutation({ mutationFn: (data: FormData) => {
    const payload = { expectedVersion: version.current, title: String(data.get('title') ?? ''), description: String(data.get('description') ?? ''), game: String(data.get('game') ?? ''), localStart: String(data.get('localStart')), timeZoneId: String(data.get('timeZoneId')), participants: selected };
    const encoded = JSON.stringify(payload); if (command.current.payload !== encoded) command.current = { payload: encoded, id: crypto.randomUUID() };
    return saveGathering(community, initial?.id ?? null, { ...payload, clientRequestId: command.current.id } satisfies Plan);
  }, onSuccess: saved });
  return <form className="gathering-form gathering-plan-form" onSubmit={event => { event.preventDefault(); if (submit.isPending || selected.length < 1 || selected.length > 50) return; submit.mutate(new FormData(event.currentTarget)); }}>
    <div className="gathering-field"><label htmlFor="g-title">{t('Gathering title (optional)')}</label><input ref={titleInput} id="g-title" name="title" maxLength={80} defaultValue={initial?.title ?? ''} disabled={submit.isPending} /></div>
    <div className="gathering-field"><label htmlFor="g-game">{t('Game (optional)')}</label><input id="g-game" name="game" maxLength={80} defaultValue={initial?.game ?? ''} disabled={submit.isPending} /></div>
    <div className="gathering-field is-wide"><label htmlFor="g-description">{t('Description (optional)')}</label><textarea id="g-description" name="description" maxLength={2000} rows={3} defaultValue={initial?.description ?? ''} disabled={submit.isPending} /></div>
    <div className="gathering-field"><label htmlFor="g-start">{t('Date and time in the selected zone')}</label><input id="g-start" name="localStart" type="datetime-local" required defaultValue={initial?.localStart ?? tomorrow()} disabled={submit.isPending} /></div>
    <div className="gathering-field"><label htmlFor="g-zone">{t('Time zone')}</label><input id="g-zone" name="timeZoneId" required maxLength={100} list="g-time-zones" defaultValue={initial?.timeZoneId ?? Intl.DateTimeFormat().resolvedOptions().timeZone} disabled={submit.isPending} /></div>
    <datalist id="g-time-zones">{['UTC','Europe/Moscow','Europe/Berlin','America/New_York','Asia/Tokyo'].map(zone => <option key={zone} value={zone} />)}</datalist>
    <p className="field-hint">{t('Date and time are interpreted in this explicit zone. Ambiguous daylight-saving times require another time.')}</p>
    <fieldset disabled={submit.isPending}><legend>{t('Select participants')}</legend>{candidates.isPending && <p role="status">{t('Loading members…')}</p>}
      <p className="field-hint">{t('{value} of 50 participants selected', { value: selected.length })}</p>
      {candidates.isError && <><p role="alert">{t(candidates.error.message)}</p><button type="button" onClick={() => void candidates.refetch()}>{t('Refresh members')}</button></>}
      {choices.length === 0 && !candidates.isPending && <p>{t('Invite a community member before creating a gathering.')}</p>}
      <div className="gathering-candidates">{choices.map(i => <div key={i.id}><label><input type="checkbox" checked={selected.includes(i.id)} disabled={!selected.includes(i.id) && selected.length >= 50} onChange={event => setSelected(ids => event.target.checked ? [...ids, i.id] : ids.filter(id => id !== i.id))} />{t('Invite')} {i.name}</label><Link to={`/profiles/${i.id}`} target="_blank" rel="noreferrer">{t('View profile')}</Link></div>)}</div>
      {candidates.hasNextPage && <button type="button" disabled={candidates.isFetchingNextPage} onClick={() => void candidates.fetchNextPage()}>{t('More members')}</button>}
    </fieldset>
    <p className="field-hint">{t('Changing date, time or game asks participants to confirm again. You can add a cover after creation.')}</p>
    {submit.isError && <p role="alert">{t(submit.error.message)} {t('Your draft is retained. Close and reopen the editor to use the latest plan.')}</p>}
    <div className="gathering-actions"><button className="primary-button" disabled={submit.isPending || selected.length < 1 || selected.length > 50}>{t(submit.isPending ? 'Saving…' : initial ? 'Save gathering' : 'Create gathering')}</button><button type="button" className="secondary-button" disabled={submit.isPending} onClick={cancel}>{t('Close editor')}</button></div>
  </form>;
}
