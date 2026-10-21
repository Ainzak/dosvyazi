import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createForumTopic, forumHref, forumKeys } from '../../api/forums';
import { useI18n } from '../../i18n/LocaleContext';

export function CreateTopic({ community, forum, user }: { community: string; forum: string; user: string }) {
  const { t } = useI18n(); const navigate = useNavigate(); const cache = useQueryClient(); const [open, setOpen] = useState(false); const [title, setTitle] = useState(''); const [content, setContent] = useState('');
  const command = useRef({ payload: '', id: crypto.randomUUID() });
  const create = useMutation({ mutationFn: () => { const payload = JSON.stringify({ title: title.trim(), content }); if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() }; return createForumTopic(community, forum, command.current.id, title.trim(), content); }, onSuccess: async topic => { await cache.invalidateQueries({ queryKey: forumKeys(user, community, forum) }); navigate(forumHref(community, forum, topic.id)); } });
  if (!open) return <button className="primary-button" onClick={() => setOpen(true)}>{t('New forum topic')}</button>;
  return <form className="forum-settings about-panel" onSubmit={event => { event.preventDefault(); if (!create.isPending && title.trim().length >= 2 && content.trim()) create.mutate(); }}><h2>{t('New forum topic')}</h2><p>{t('Start a named discussion in this forum. Everyone who can view the forum can read it.')}</p><label>{t('Topic title')}<input autoFocus required minLength={2} maxLength={80} value={title} disabled={create.isPending} onChange={e => setTitle(e.target.value)} /></label><label>{t('First post')}<textarea aria-label={t('First post')} required maxLength={4000} rows={4} value={content} disabled={create.isPending} onChange={e => setContent(e.target.value)} /></label>{create.isError && <p role="alert">{t(create.error.message)}</p>}<div className="settings-actions"><button className="primary-button" disabled={create.isPending || title.trim().length < 2 || !content.trim()}>{t(create.isPending ? 'Creating topic…' : 'Create forum topic')}</button><button type="button" className="secondary-button" disabled={create.isPending} onClick={() => setOpen(false)}>{t('Cancel')}</button></div></form>;
}
