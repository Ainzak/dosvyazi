import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { communityKeys, communityListKey, createInvite, joinCommunity, listInvites, revokeInvite } from '../../api/communities';
import { useI18n } from '../../i18n/LocaleContext';
import { useSession } from '../accounts/useSession';
import { X } from 'lucide-react';

export function InvitePeople({ community, user }: { community: string; user: string }) {
  const { t, locale } = useI18n(); const cache = useQueryClient(); const id = useId();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const request = useRef({ hours: 0, id: crypto.randomUUID() });
  const [open, setOpen] = useState(false), [copy, setCopy] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!open) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [open]);
  const key = [...communityKeys(user, community), 'invites'];
  const invites = useQuery({ queryKey: key, queryFn: ({ signal }) => listInvites(community, signal), enabled: open, refetchInterval: open ? 30_000 : false });
  const refresh = () => cache.invalidateQueries({ queryKey: key });
  const create = useMutation({ mutationFn: (hours: number) => {
    if (request.current.hours !== hours) request.current = { hours, id: crypto.randomUUID() };
    return createInvite(community, { clientRequestId: request.current.id, lifetimeHours: hours });
  }, onSuccess: () => { request.current = { hours: 0, id: crypto.randomUUID() }; setCopy(''); void refresh(); } });
  const revoke = useMutation({ mutationFn: (invite: string) => revokeInvite(community, invite), onSuccess: invite => { if (create.data?.invite.id === invite.id) create.reset(); void refresh(); } });
  const active = invites.data?.filter(invite => !invite.revoked && Date.parse(invite.expiresAt) > now && (invite.maxUses == null || Number(invite.uses) < Number(invite.maxUses)));
  const known = invites.data?.find(invite => invite.id === create.data?.invite.id);
  const available = !known || (!known.revoked && (known.maxUses == null || Number(known.uses) < Number(known.maxUses)));
  const url = create.data && available && !create.data.invite.revoked && Date.parse(create.data.invite.expiresAt) > now ? `${location.origin}/invite/${create.data.code}` : '';
  return <><button ref={trigger} type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => { setOpen(true); setNow(Date.now()); dialog.current?.showModal(); }}>{t('Invite people')}</button>
    <dialog ref={dialog} className="management-dialog invite-dialog" aria-labelledby={`${id}-title`} onClose={() => { setOpen(false); trigger.current?.focus(); }} onClick={event => {
      if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
    }}><div className="invite-dialog-heading"><h2 id={`${id}-title`}>{t('Invite people')}</h2><button type="button" className="icon-button" aria-label={t('Close invitation dialog')} title={t('Close invitation dialog')} onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></div><p>{t('Create a link with an expiry time. There is no participant limit.')}</p>
      <form onSubmit={event => { event.preventDefault(); if (!create.isPending) create.mutate(Number(new FormData(event.currentTarget).get('hours'))); }}>
        <label htmlFor={`${id}-hours`}>{t('Expires in (hours)')}</label><input id={`${id}-hours`} name="hours" type="number" min={1} max={168} defaultValue={24} required />
        <button className="primary-button" disabled={create.isPending}>{t(create.isPending ? 'Creating…' : 'Create invitation')}</button>
      </form>{create.error && <p role="alert">{t(create.error.message)}</p>}
      {url && <section className="created-invite"><label htmlFor={`${id}-link`}>{t('Invitation link')}</label><input id={`${id}-link`} value={url} readOnly onFocus={event => event.currentTarget.select()} /><button type="button" className="secondary-button" onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => setCopy('Link copied.'), () => setCopy('Select and copy the link above.'));
        if (!navigator.clipboard) setCopy('Select and copy the link above.');
      }}>{t('Copy link')}</button><p role="status">{t(copy)}</p><p className="field-hint">{t('Share privately. This link grants community membership, not access to private channels.')}</p></section>}
      <h3>{t('Active invitations')}</h3>{invites.isPending && open && <p role="status">{t('Loading invitations…')}</p>}
      {invites.error && <p role="alert">{t(invites.error.message)} <button type="button" className="secondary-button" onClick={() => void invites.refetch()}>{t('Try again')}</button></p>}
      {!invites.isError && active?.length === 0 && <p>{t('No active invitations.')}</p>}
      <ul className="management-list">{active?.map(invite => <li key={invite.id}><span>{t('Expires {value}', { value: new Date(invite.expiresAt).toLocaleString(locale) })}</span><button type="button" className="secondary-button" disabled={revoke.isPending} aria-label={t('Revoke invitation {value}', { value: invite.id.slice(0, 8) })} onClick={() => revoke.mutate(invite.id)}>{t('Revoke')}</button></li>)}</ul>
      {revoke.error && <p role="alert">{t(revoke.error.message)}</p>}
      <button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>{t('Close')}</button>
    </dialog></>;
}

export function InvitationPage() {
  const { t } = useI18n(); const { code = '' } = useParams(); const session = useSession(); const navigate = useNavigate(); const cache = useQueryClient();
  const join = useMutation({ mutationFn: () => joinCommunity(code), onSuccess: async community => {
    if (session.data) await cache.invalidateQueries({ queryKey: communityListKey(session.data.id) }); navigate(`/communities/${community.id}`);
  } });
  if (!/^[a-f0-9]{64}$/.test(code)) return <section className="about-panel"><h1>{t('Invitation unavailable')}</h1><p>{t('Ask the community owner for a new invitation link.')}</p></section>;
  const returnTo = `/invite/${code}`;
  return <section className="about-panel"><h1>{t('Community invitation')}</h1><p>{t('Join this community to see its shared channels. Private channels keep their access rules.')}</p>
    {session.isPending ? <p role="status">{t('Checking your session…')}</p> : session.error ? <p role="alert">{t(session.error.message)} <button className="secondary-button" onClick={() => void session.refetch()}>{t('Try again')}</button></p> : session.data ? <button className="primary-button" disabled={join.isPending} onClick={() => join.mutate()}>{t(join.isPending ? 'Joining…' : 'Join community')}</button> : <><p>{t('Sign in or create an account to accept this invitation.')}</p><Link className="secondary-button" to="/login" state={{ returnTo }}>{t('Sign in')}</Link> <Link className="secondary-button" to="/register" state={{ returnTo }}>{t('Create account')}</Link></>}
    {join.error && <p role="alert">{t(join.error.message)}</p>}
  </section>;
}
