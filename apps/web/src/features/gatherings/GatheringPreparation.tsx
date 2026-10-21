import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarDays, ClipboardCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { calendarUrl, gatheringKeys, getPreparation, saveChecklist, saveReminder } from '../../api/gatherings';
import type { ChecklistCommand, Gathering, Preparation, ReminderCommand } from '../../api/gatherings';
import { ApiError, callApi, readJson } from '../../api/http';
import { useI18n } from '../../i18n/LocaleContext';

type Item = Preparation['items'][number];
type Edit = { id: string; text: string; assignee: string; version: string };
type ChecklistIntent = Omit<ChecklistCommand, 'clientRequestId' | 'text' | 'done'> & Partial<Pick<ChecklistCommand, 'text' | 'done'>>;
const conflict = (e: Error | null) => e instanceof ApiError && e.status === 409;

export function GatheringPreparation({ gathering: g, user }: { gathering: Gathering; user: string }) {
  const { t } = useI18n(); const client = useQueryClient();
  const key = [...gatheringKeys(user, g.communityId), 'detail', g.id, 'preparation'];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => getPreparation(g.communityId, g.id, signal), refetchInterval: 5000 });
  const [editor, setEditor] = useState<Edit | null>(null); const input = useRef<HTMLInputElement>(null); const add = useRef<HTMLButtonElement>(null);
  const receipt = useRef({ key: '', id: crypto.randomUUID() });
  const refresh = () => client.invalidateQueries({ queryKey: gatheringKeys(user, g.communityId) });
  const change = useMutation({ mutationFn: (value: { item: string; request: ChecklistIntent }) => {
    const fingerprint = JSON.stringify(value); if (receipt.current.key !== fingerprint) receipt.current = { key: fingerprint, id: crypto.randomUUID() };
    return saveChecklist(g.communityId, g.id, value.item, { text: '', done: false, ...value.request, clientRequestId: receipt.current.id });
  }, onSuccess: async data => { await client.cancelQueries({ queryKey: key }); client.setQueryData(key, data); setEditor(null); receipt.current.key = ''; add.current?.focus(); await refresh(); }, onError: refresh });
  const closed = g.status !== 'Scheduled'; const data = query.data;
  const unavailable = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const open = (item?: Item) => { if (!data) return; change.reset(); setEditor({ id: item?.id ?? crypto.randomUUID(), text: item?.text ?? '', assignee: item?.assigneeId ?? '', version: data.version }); requestAnimationFrame(() => input.current?.focus()); };
  const assignees = [{ userId: g.organizerId, name: g.organizerName }, ...g.invites.filter(i => i.currentMember)];
  return <section className="gathering-surface gathering-preparation" aria-labelledby="g-preparation-title">
    <h2 id="g-preparation-title"><ClipboardCheck size={20} aria-hidden="true" />{t('Preparation checklist')}</h2>
    <p className="field-hint">{t('The organizer assigns tasks. The responsible participant or organizer marks them ready. Changing the time or game clears readiness.')}</p>
    {query.isPending && <p role="status">{t('Loading preparation…')}</p>}
    {query.isError && <div><p role="alert">{t(query.error.message)}</p><button className="secondary-button" onClick={() => void query.refetch()}>{t('Try again')}</button></div>}
    {data && !unavailable && <>
      <p className="field-hint">{t('{ready} of {total} tasks ready', { ready: data.items.filter(i => i.done).length, total: data.items.length })}</p>
      {!data.items.length && <p>{t('No preparation tasks yet.')}</p>}
      <ul className="gathering-checklist">{data.items.map(item => <li key={item.id}>
        <label className="gathering-task"><input type="checkbox" checked={item.done} disabled={closed || change.isPending || !!editor || !(g.canManage || item.assigneeId === user)}
          onChange={e => change.mutate({ item: item.id, request: { expectedVersion: data.version, action: 'complete', done: e.target.checked } })} />
          <span><span className={item.done ? 'is-ready' : ''}>{item.text}</span><small>{t('Responsible')}: {assignees.find(i => i.userId === item.assigneeId)?.name ?? t('Unassigned')}</small></span></label>
        {g.canManage && !closed && <div className="gathering-actions"><button className="secondary-button" disabled={change.isPending} aria-label={t('Edit task: {value}', { value: item.text })} onClick={() => open(item)}><Pencil size={16} aria-hidden="true" /></button>
          <button className="secondary-button" disabled={change.isPending || !!editor} aria-label={t('Remove task: {value}', { value: item.text })} onClick={() => change.mutate({ item: item.id, request: { expectedVersion: data.version, action: 'remove' } })}><Trash2 size={16} aria-hidden="true" /></button></div>}
      </li>)}</ul>
      {g.canManage && !closed && <>
        {!editor && <button ref={add} className="secondary-button" disabled={change.isPending || data.items.length >= 30} onClick={() => open()}><Plus size={16} aria-hidden="true" />{t('Add preparation task')}</button>}
        {editor && <form className="gathering-form" onSubmit={e => { e.preventDefault(); if (!change.isPending && editor.text.trim() && !conflict(change.error)) change.mutate({ item: editor.id, request: { expectedVersion: editor.version, action: 'save', text: editor.text, assigneeId: editor.assignee || null } }); }}>
          <label htmlFor="g-task-text">{t('Preparation task')}</label><input id="g-task-text" ref={input} maxLength={160} required value={editor.text} disabled={change.isPending} onChange={e => setEditor({ ...editor, text: e.target.value })} />
          <label htmlFor="g-task-assignee">{t('Responsible participant')}</label><select id="g-task-assignee" value={editor.assignee} disabled={change.isPending} onChange={e => setEditor({ ...editor, assignee: e.target.value })}><option value="">{t('Unassigned')}</option>{assignees.map(i => <option key={i.userId} value={i.userId}>{i.name}</option>)}</select>
          <div className="gathering-actions"><button className="primary-button" disabled={change.isPending || !editor.text.trim() || conflict(change.error)}>{t('Save preparation task')}</button><button type="button" className="secondary-button" disabled={change.isPending} onClick={() => { setEditor(null); change.reset(); receipt.current.key = ''; requestAnimationFrame(() => add.current?.focus()); }}>{t('Close editor')}</button></div>
        </form>}
      </>}
      {change.isError && <div className="gathering-change"><p role="alert">{t(change.error.message)}</p>{conflict(change.error) ? <button className="secondary-button" onClick={() => { if (editor) setEditor({ ...editor, version: data.version }); change.reset(); receipt.current.key = ''; }}>{t('I reviewed the latest checklist')}</button> : <button className="secondary-button" onClick={() => change.mutate(change.variables!)} disabled={change.isPending}>{t('Retry checklist action')}</button>}</div>}
      <PersonalReminder gathering={g} preparation={data} saved={async result => { await client.cancelQueries({ queryKey: key }); client.setQueryData(key, result); await refresh(); }} reload={refresh} />
      <details className="gathering-calendar"><summary><CalendarDays size={18} aria-hidden="true" />{t('Add to my calendar')}</summary>
        <p className="field-hint">{t('Downloads a snapshot with the title and start time only. The file contains no participants or discussion. Your calendar will not update automatically: import a fresh file after changes or cancellation. Exported copies cannot be revoked.')}</p>
        <p>{g.title} · {t('Organizer time')}: {g.localStart.replace('T', ' ')} · {g.timeZoneId}</p>
        <CalendarDownload gathering={g} />
      </details>
    </>}
  </section>;
}

function PersonalReminder({ gathering: g, preparation: data, saved, reload }: { gathering: Gathering; preparation: Preparation; saved: (data: Preparation) => Promise<void>; reload: () => Promise<void> }) {
  const { t, locale } = useI18n(); const own = data.reminder;
  const [minutes, setMinutes] = useState(String(own.minutes ?? ''));
  const [reviewed, setReviewed] = useState({ version: own.version, revision: Number(g.revision) });
  const receipt = useRef({ key: '', id: crypto.randomUUID() });
  const update = useMutation({ mutationFn: (value: Omit<ReminderCommand, 'clientRequestId'>) => {
    const key = JSON.stringify(value); if (receipt.current.key !== key) receipt.current = { key, id: crypto.randomUUID() };
    return saveReminder(g.communityId, g.id, { ...value, clientRequestId: receipt.current.id });
  }, onSuccess: async next => { receipt.current.key = ''; setReviewed({ version: next.reminder.version, revision: Number(g.revision) }); setMinutes(String(next.reminder.minutes ?? '')); await saved(next); }, onError: reload });
  const changed = reviewed.version !== own.version || reviewed.revision !== Number(g.revision);
  return <div className="gathering-reminder"><h3><Bell size={18} aria-hidden="true" />{t('My reminder')}</h3>
    <p className="field-hint">{t('A personal notification inside Dosvyazi, not an email or push. It appears while you use the app. Time or game changes require you to enable it again.')}</p>
    <p role="status">{own.minutes === null ? t('Reminder is off.') : own.deliveredAt ? t('Reminder delivered.') : t('Reminder enabled: {value}', { value: new Date(own.dueAt!).toLocaleString(locale, { timeZoneName: 'short' }) })}</p>
    {data.canRemind && <form className="gathering-reminder-form" onSubmit={e => { e.preventDefault(); if (!update.isPending && !changed && !conflict(update.error)) update.mutate({ expectedVersion: reviewed.version, expectedRevision: reviewed.revision, minutes: minutes ? Number(minutes) : null }); }}>
      <label htmlFor="g-reminder">{t('Remind me before the start')}</label><select id="g-reminder" value={minutes} disabled={update.isPending} onChange={e => setMinutes(e.target.value)}>
        <option value="">{t('No reminder')}</option><option value="5">{t('5 minutes')}</option><option value="15">{t('15 minutes')}</option><option value="60">{t('1 hour')}</option><option value="1440">{t('1 day')}</option></select>
      <button className="secondary-button" disabled={update.isPending || changed || conflict(update.error)}>{t('Save my reminder')}</button>
    </form>}
    {!data.canRemind && <p className="field-hint">{t('Reminders are available to the organizer and invitees before the gathering starts.')}</p>}
    {update.isError && <p role="alert">{t(update.error.message)}</p>}
    {(changed || conflict(update.error)) && <button className="secondary-button" onClick={() => { setReviewed({ version: own.version, revision: Number(g.revision) }); setMinutes(String(own.minutes ?? '')); update.reset(); receipt.current.key = ''; }}>{t('I reviewed the latest reminder and plan')}</button>}
    {update.isError && !conflict(update.error) && <button className="secondary-button" disabled={update.isPending} onClick={() => update.mutate(update.variables!)}>{t('Retry reminder action')}</button>}
  </div>;
}

function CalendarDownload({ gathering: g }: { gathering: Gathering }) {
  const { t } = useI18n(); const active = useRef<AbortController | null>(null); const href = useRef<string | null>(null);
  useEffect(() => () => { active.current?.abort(); if (href.current) URL.revokeObjectURL(href.current); }, [g.id, g.version]);
  const download = useMutation({ mutationFn: async () => {
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    try {
      const response = await callApi(calendarUrl(g.communityId, g.id), { signal: controller.signal });
      if (!response.ok) await readJson(response);
      const blob = await response.blob(); if (controller.signal.aborted) return;
      if (href.current) URL.revokeObjectURL(href.current); href.current = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = href.current; link.download = 'gathering.ics'; link.click();
    } catch (error) { if (!controller.signal.aborted) throw error; }
  } });
  return <><button className="secondary-button" disabled={download.isPending} onClick={() => download.mutate()}>{t('Download calendar file')}</button>{download.isError && <p role="alert">{t(download.error.message)}</p>}</>;
}
