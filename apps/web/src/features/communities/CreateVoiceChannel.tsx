import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { communityKeys, getAccess, saveAccess } from '../../api/communities';
import type { AccessPolicy } from '../../api/communities';
import { voiceHref } from '../../api/voice';
import { useI18n } from '../../i18n/LocaleContext';

export function CreateVoiceChannel({ community, user }: { community: string; user: string }) {
  const { t } = useI18n(); const id = useId(); const navigate = useNavigate(); const cache = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [name, setName] = useState('');
  const request = useRef<{ body: string; request: string; channel: string } | null>(null);
  const policy = useQuery({ queryKey: [...communityKeys(user, community), 'creation-policy'], queryFn: ({ signal }) => getAccess(community, signal), enabled: open, staleTime: 0 });
  const create = useMutation({ mutationFn: async (initial: AccessPolicy) => {
    const body = JSON.stringify({ initial, name: name.trim() });
    if (request.current?.body !== body) request.current = { body, request: crypto.randomUUID(), channel: crypto.randomUUID() };
    const command = request.current;
    await saveAccess(community, command.request, { ...initial, voiceChannels: [...initial.voiceChannels ?? [], { id: command.channel, name: name.trim(), categoryId: null }] });
    return command.channel;
  }, onSuccess: async channel => { await cache.invalidateQueries({ queryKey: communityKeys(user, community) }); dialog.current?.close(); navigate(voiceHref(community, channel)); } });
  return <><button ref={trigger} className="icon-button" aria-label={t('Create voice channel')} title={t('Create voice channel')} aria-haspopup="dialog" onClick={() => { create.reset(); setOpen(true); dialog.current?.showModal(); }}><Plus size={18} aria-hidden="true" /></button>
    <dialog ref={dialog} className="management-dialog voice-channel-dialog" aria-labelledby={`${id}-title`} onCancel={event => { if (create.isPending) event.preventDefault(); }} onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <h2 id={`${id}-title`}>{t('Create voice channel')}</h2><p className="field-hint">{t('Members inherit community permissions. Change detailed access rules in community settings.')}</p>
      {policy.isPending && <p role="status">{t('Loading…')}</p>}
      {policy.error && <p role="alert">{t(policy.error.message)}</p>}
      <form onSubmit={event => { event.preventDefault(); if (policy.data && !policy.isFetching && !create.isPending) create.mutate(policy.data); }}>
        <label htmlFor={`${id}-name`}>{t('Channel name')}</label><input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} minLength={1} maxLength={80} required disabled={create.isPending} />
        {create.error && <p role="alert">{t(create.error.message)}</p>}
        <div className="settings-actions"><button className="primary-button" disabled={!policy.data || policy.isError || policy.isFetching || create.isPending || !name.trim()}>{t(create.isPending ? 'Creating…' : 'Create voice channel')}</button><button type="button" className="secondary-button" disabled={create.isPending} onClick={() => dialog.current?.close()}>{t('Cancel')}</button></div>
      </form>{(create.isError || policy.isError) && <button className="secondary-button" disabled={policy.isFetching} onClick={() => { create.reset(); void policy.refetch(); }}>{t('Reload access')}</button>}
    </dialog></>;
}
