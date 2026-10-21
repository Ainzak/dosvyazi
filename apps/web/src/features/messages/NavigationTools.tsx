import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/navigation';
import { callApi, readJson } from '../../api/http';
import { useI18n } from '../../i18n/LocaleContext';
import { AttachmentDownload } from './AttachmentDownload';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

export function NotificationPreference({ scope }: { scope: api.Scope }) {
  const { t } = useI18n(); const client = useQueryClient(); const key = [...api.navigationKeys(scope.user), scope.kind, scope.container, 'preference'];
  const data = useQuery({ queryKey: key, queryFn: ({ signal }) => api.preference(scope, signal) });
  const command = useRef({ mode: '', id: crypto.randomUUID() });
  const save = useMutation({ mutationFn: (mode: string) => { if (mode !== command.current.mode) command.current = { mode, id: crypto.randomUUID() }; return api.setPreference(scope, mode, command.current.id); }, onSuccess: value => { client.setQueryData(key, value); void client.invalidateQueries({ queryKey: [...api.navigationKeys(scope.user), 'notices'] }); } });
  return <details className="conversation-notifications"><summary>{t('Notification settings')}</summary><label>{t('Notify me about')}<select aria-label={t('Notify me about')} value={data.data?.mode ?? ''} disabled={!data.data || data.isError || save.isPending} onChange={e => save.mutate(e.target.value)}><option value="" disabled>{t('Loading…')}</option><option value="all">{t('All new messages')}</option><option value="mentions">{t('Mentions and replies')}</option><option value="quiet">{t('Quiet')}</option></select></label><small>{t('In-app notifications only. Unread counts are unchanged. Changes affect new messages; edits do not notify again.')}</small>{(data.error || save.error) && <p role="alert">{t((data.error || save.error)!.message)}</p>}</details>;
}

export function MentionPicker({ scope, selected, change, disabled }: { scope: api.Scope; selected: api.Member[]; change: (members: api.Member[]) => void; disabled: boolean }) {
  const { t } = useI18n(); const [open, setOpen] = useState(false); const [query, setQuery] = useState('');
  const element = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open) return; const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.current?.contains(event.target)) setOpen(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, [open]);
  const data = useQuery({ queryKey: [...api.navigationKeys(scope.user), scope.kind, scope.container, 'members', query], queryFn: ({ signal }) => api.members(scope, query, signal), enabled: open });
  return <div className="mention-picker" ref={element} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}><button ref={trigger} type="button" className="secondary-button" aria-label={t('Mention a member')} title={t('Mention a member')} aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}> @ </button>{open && <section className="mention-options" aria-label={t('Choose a member to mention')}><label>{t('Search members')}<input aria-label={t('Search members')} maxLength={40} value={query} onChange={e => setQuery(e.target.value)} /></label><p className="field-hint">{t('Choose up to 10 members. Typing a name alone does not send a notification.')}</p>{data.isPending && <p role="status">{t('Loading…')}</p>}{data.error && <p role="alert">{t(data.error.message)}</p>}{data.data?.length === 0 && <p>{t('No matching members.')}</p>}{!data.isError && data.data?.map(member => <button key={member.id} type="button" className="secondary-button" disabled={selected.length >= 10 || selected.some(s => s.id === member.id)} onClick={() => { change([...selected, member]); setOpen(false); }}>{member.name}</button>)}<button type="button" className="secondary-button" onClick={() => setOpen(false)}>{t('Close')}</button></section>}</div>;
}

export function DraftReferences({ reply, mentions, clearReply, removeMention, disabled }: { reply: { id: string; authorName: string } | null; mentions: api.Member[]; clearReply: () => void; removeMention: (id: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  return <div className="draft-references">{reply && <p>{t('Replying to {value}', { value: reply.authorName })} <button type="button" className="secondary-button" disabled={disabled} onClick={clearReply}>{t('Cancel reply')}</button></p>}{mentions.map(member => <span key={member.id}>@{member.name} <button type="button" className="secondary-button" disabled={disabled} aria-label={t('Remove mention: {value}', { value: member.name })} onClick={() => removeMention(member.id)}>×</button></span>)}</div>;
}

function useSource(scope: api.Scope, message: string) {
  return useQuery({ queryKey: [...api.navigationKeys(scope.user), scope.kind, scope.container, 'source', message], queryFn: ({ signal }) => api.source(scope, message, signal) });
}
export function ReplyReference({ scope, message }: { scope: api.Scope; message: string }) {
  const { t } = useI18n(); const data = useSource(scope, message);
  return <div className="reply-reference">{data.isPending ? t('Loading reply source…') : data.isError ? t('Reply source is unavailable.') : <Link to={data.data.href}>{t('Reply to {value}', { value: data.data.authorName })}: {data.data.content.slice(0, 160) || t('Attachment message')}</Link>}</div>;
}
export function MentionLabels({ users, user }: { users?: string[] | null | undefined; user: string }) {
  return !!users?.length && <div className="message-mentions">{users.map(id => <MentionLabel key={id} id={id} user={user} />)}</div>;
}
function MentionLabel({ id, user }: { id: string; user: string }) {
  const { t } = useI18n();
  const data = useQuery({ queryKey: ['private', user, 'mention-profile', id], queryFn: ({ signal }) => callApi(`/api/v1/profiles/${id}`, { signal }).then(readJson<{ displayName: string }>), refetchInterval: 60000 });
  return <Link to={`/profiles/${id}`}>@{data.isError ? t('Mentioned member') : data.data?.displayName ?? t('Mentioned member')}</Link>;
}
export function FocusedMessage({ scope }: { scope: api.Scope }) {
  const [search, setSearch] = useSearchParams(); const id = search.get('message');
  if (!id) return null;
  return <FocusedSource key={id} scope={scope} id={id} close={() => { const next = new URLSearchParams(search); next.delete('message'); setSearch(next, { replace: true }); }} />;
}
function FocusedSource({ scope, id, close }: { scope: api.Scope; id: string; close: () => void }) {
  const { t } = useI18n(); const data = useSource(scope, id); const element = useRef<HTMLElement>(null);
  const attachment = data.data?.attachment;
  const url = attachment && data.data ? scope.kind === 'direct' ? `/api/v1/direct-messages/${scope.container}/attachments/${attachment.id}` : `/api/v1${data.data.href.split('?')[0]}/attachments/${attachment.id}` : '';
  useEffect(() => { element.current?.focus(); }, [id]);
  return <section ref={element} tabIndex={-1} className="focused-message" aria-label={t('Referenced message')}><h3>{t('Referenced message')}</h3>{data.isPending ? <p role="status">{t('Loading…')}</p> : data.isError ? <p role="alert">{t('Message source is unavailable.')}</p> : <><strong>{data.data.authorName}</strong><p>{data.data.content || t('Attachment message')}</p>{attachment && <>{attachment.kind === 'Voice' && <VoiceMessagePlayer url={url} duration={Number(attachment.durationMs)} />}<AttachmentDownload attachment={attachment} url={url} /></>}</>}<button className="secondary-button" onClick={close}>{t('Back to latest messages')}</button></section>;
}

export function BookmarkButton({ scope, message, existing }: { scope: api.Scope; message: string; existing?: api.Bookmark }) {
  const { t } = useI18n(); const cache = useQueryClient(); const title = useId(); const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false); const [note, setNote] = useState(existing?.note ?? ''); const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [saved, setSaved] = useState(!!existing);
  const request = useRef({ payload: '', id: crypto.randomUUID() });
  const load = useMutation({ mutationFn: () => api.bookmarkInfo(scope, message), onSuccess: current => { setSaved(!!current); setNote(current?.note ?? ''); setTags(current?.tags.join(', ') ?? ''); request.current = { payload: '', id: crypto.randomUUID() }; setOpen(true); save.reset(); } });
  const save = useMutation({ mutationFn: (removed: boolean) => { const values = tags.split(',').map(v => v.trim()).filter(Boolean); const payload = JSON.stringify({ removed, note, values }); if (payload !== request.current.payload) request.current = { payload, id: crypto.randomUUID() }; return api.saveBookmark(scope, message, note, values, removed, request.current.id); }, onSuccess: (_, removed) => { setSaved(!removed); dialog.current?.close(); void cache.invalidateQueries({ queryKey: api.navigationKeys(scope.user) }); } });
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  return <><button ref={trigger} type="button" className="secondary-button" aria-haspopup="dialog" disabled={load.isPending || save.isPending} onClick={() => load.mutate()}>{t(saved ? 'Edit bookmark' : 'Bookmark')}</button>{open && createPortal(<dialog ref={dialog} className="management-dialog bookmark-dialog" aria-labelledby={title} onCancel={event => { if (save.isPending) event.preventDefault(); }} onClose={() => { setOpen(false); const details = trigger.current?.closest('details'); if (details && !details.open) details.querySelector('summary')?.focus(); else trigger.current?.focus(); }}><h2 id={title}>{t(saved ? 'Edit bookmark' : 'Bookmark')}</h2><p>{t('Only you can see your tags and note. The source still requires conversation access.')}</p><form onSubmit={e => { e.preventDefault(); if (!save.isPending) save.mutate(false); }}><label>{t('Private note')}<textarea aria-label={t('Private note')} value={note} onChange={e => setNote(e.target.value)} maxLength={500} disabled={save.isPending} /></label><label>{t('Tags, separated by commas')}<input aria-label={t('Tags, separated by commas')} value={tags} onChange={e => setTags(e.target.value)} maxLength={206} disabled={save.isPending} /></label><p className="field-hint">{t('Up to 8 tags, 24 characters each.')}</p>{save.error && <p role="alert">{t(save.error.message)}</p>}<div className="settings-actions"><button className="primary-button" disabled={save.isPending}>{t(save.isPending ? 'Saving…' : 'Save bookmark')}</button>{saved && <button type="button" className="secondary-button" disabled={save.isPending} onClick={() => save.mutate(true)}>{t('Remove bookmark')}</button>}<button type="button" className="secondary-button" disabled={save.isPending} onClick={() => dialog.current?.close()}>{t('Cancel')}</button></div></form></dialog>, document.body)}{load.error && <p role="alert">{t(load.error.message)}</p>}</>;
}
