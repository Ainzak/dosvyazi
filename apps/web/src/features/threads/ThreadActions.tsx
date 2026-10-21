import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createThread, threadHref, threadKeys } from '../../api/threads';
import type { Thread } from '../../api/threads';
import { useI18n } from '../../i18n/LocaleContext';

export function ThreadActions({ user, community, parent, root, existing, canCreate }: { user: string; community: string; parent: string; root: string; existing?: Thread | undefined; canCreate: boolean }) {
  const { t } = useI18n(); const client = useQueryClient(); const navigate = useNavigate(); const [open, setOpen] = useState(false); const [title, setTitle] = useState('');
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const request = useRef({ payload: '', id: crypto.randomUUID() });
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const create = useMutation({ mutationFn: () => {
    const payload = JSON.stringify({ root, title: title.trim() }); if (request.current.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    return createThread(community, parent, request.current.id, root, title.trim());
  }, onSuccess: async result => { await client.invalidateQueries({ queryKey: threadKeys(user, community, parent) }); dialog.current?.close(); navigate(threadHref(community, parent, result.id)); } });
  if (existing && !open) return <Link className="about-link thread-badge" to={threadHref(community, parent, existing.id)}>{t(existing.archived ? 'Open archived message thread' : 'Open message thread')} · {existing.title}</Link>;
  if (!canCreate && !open) return null;
  return <><button ref={trigger} type="button" className="secondary-button" onClick={() => { create.reset(); setOpen(true); }}>{t('Start message thread')}</button>
    <dialog ref={dialog} className="management-dialog" aria-label={t('Start a message thread')} onCancel={event => { if (create.isPending) event.preventDefault(); }} onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      {open && <form onSubmit={event => { event.preventDefault(); if (!create.isPending && title.trim().length >= 2) create.mutate(); }}><h2>{t('Start a message thread')}</h2><p>{t('Everyone who can view this channel can read the thread. Replies stay in their own conversation.')}</p><label>{t('Message thread title')}<input autoFocus required minLength={2} maxLength={80} value={title} disabled={create.isPending} onChange={e => setTitle(e.target.value)} /></label>{create.isError && <p role="alert">{t(create.error.message)}</p>}<div className="settings-actions"><button type="button" className="secondary-button" disabled={create.isPending} onClick={() => dialog.current?.close()}>{t('Cancel')}</button><button className="primary-button" disabled={create.isPending || title.trim().length < 2}>{t(create.isPending ? 'Creating thread…' : 'Create thread')}</button></div></form>}
    </dialog></>;
}
