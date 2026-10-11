import { useI18n } from '../../i18n/LocaleContext';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Hash, Users } from 'lucide-react';
import type { UserProfile } from '../../api/accounts';
import { ApiError } from '../../api/http';
import { banMember, communityKeys, communityListKey, createCommunity, createInvite, getChannel, getCommunity,
  joinCommunity, leaveCommunity, listCommunities, listInvites, listMembers, privateKeys, revokeInvite, kickMember } from '../../api/communities';
import type { CommunityDetails } from '../../api/communities';
import { useSession } from '../accounts/useSession';
import { MessageTimeline } from '../messages/MessageTimeline';
import { VoicePanel } from '../voice/VoicePanel';
import { AccessPanel } from './AccessPanel';
import { AuditPanel } from './AuditPanel';

function Recovery({ title = 'Connection interrupted.', error, retry }: { title?: string; error: Error; retry: () => void }) {
  const { t } = useI18n();
  return <section className="about-panel"><h1>{t(title)}</h1><p role="alert">{t(error.message)}</p><button className="secondary-button" onClick={retry}>{t("Try again")}</button></section>;
}

function AccountGate({ children }: { children: (user: UserProfile) => ReactNode }) {
  const { t } = useI18n();
  const session = useSession();
  if (session.isPending) return <p role="status">{t("Checking your session…")}</p>;
  if (session.isError && !session.data) return <Recovery error={session.error} retry={() => void session.refetch()} />;
  if (!session.data) return <section className="about-panel"><h1>{t("A place for your people.")}</h1><p>{t("Sign in to create a community or join with an invitation.")}</p><Link className="about-link" to="/login">{t("Sign in")}</Link></section>;
  return <>{session.isError && <div className="message-error"><p role="alert">{t("Session check interrupted. ")}{t(session.error.message)}</p><button className="secondary-button" onClick={() => void session.refetch()}>{t("Retry session check")}</button></div>}{children(session.data)}</>;
}

function CommunityList({ user }: { user: UserProfile }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: communityListKey(user.id), queryFn: ({ signal }) => listCommunities(signal) });
  const creation = useRef({ name: '', id: crypto.randomUUID() });
  const enter = async (community: CommunityDetails) => {
    await client.invalidateQueries({ queryKey: communityListKey(user.id) });
    navigate(`/communities/${community.id}`);
  };
  const create = useMutation({ mutationFn: (name: string) => {
    if (creation.current.name !== name) creation.current = { name, id: crypto.randomUUID() };
    return createCommunity({ name, clientRequestId: creation.current.id });
  }, onSuccess: enter });
  const join = useMutation({ mutationFn: joinCommunity, onSuccess: enter });
  return <>
    <div className="page-heading"><div><p className="eyebrow">{t("YOUR COMMUNITIES")}</p><h1>{t("A place for your people.")}</h1><p className="page-description">{t("Create a shared space, or join one with an invitation.")}</p></div></div>
    <div className="community-forms">
      <section className="about-panel"><h2>{t("Create a community")}</h2><form onSubmit={event => { event.preventDefault(); create.mutate(String(new FormData(event.currentTarget).get('name') ?? '').trim()); }}>
        <label htmlFor="community-name">{t("Community name")}</label><input id="community-name" name="name" minLength={2} maxLength={80} required />
        <p className="field-hint">{t("A general text channel is included. Only members can see your community.")}</p>
        {create.isError && <p role="alert" className="form-error">{t(create.error.message)}</p>}
        <button className="primary-button" disabled={create.isPending}>{create.isPending ? t("Creating…") : t("Create community")}</button>
      </form></section>
      <section className="about-panel"><h2>{t("Join a community")}</h2><form onSubmit={event => { event.preventDefault(); join.mutate(String(new FormData(event.currentTarget).get('code') ?? '').trim()); }}>
        <label htmlFor="join-code">{t("Invitation code")}</label><input id="join-code" name="code" type="password" autoComplete="off" minLength={64} maxLength={64} required />
        <p className="field-hint">{t("Ask the community owner for a code. Codes can expire or run out of uses.")}</p>
        {join.isError && <p role="alert" className="form-error">{t(join.error.message)}</p>}
        <button className="primary-button" disabled={join.isPending}>{join.isPending ? t("Joining…") : t("Join community")}</button>
      </form></section>
    </div>
    <section className="community-directory" aria-labelledby="communities-heading"><h2 id="communities-heading">{t("Your shared spaces")}</h2>
      {list.isPending ? <p role="status">{t("Loading communities…")}</p> : list.isError ? <Recovery error={list.error} retry={() => void list.refetch()} /> : list.data.length === 0 ? <div className="empty-community"><Users aria-hidden="true" /><h3>{t("No communities yet.")}</h3><p>{t("Create your first community or use an invitation above.")}</p></div> : <div className="community-cards">{list.data.map(community => <Link className="community-card" key={community.id} to={`/communities/${community.id}`}><Users size={22} aria-hidden="true" /><div><h3>{community.name}</h3><span>{t(community.role)}</span></div></Link>)}</div>}
    </section>
  </>;
}

function OwnerTools({ community, user }: { community: CommunityDetails; user: UserProfile }) {
  const { t, locale } = useI18n();
  const permissions = Number(community.permissions);
  const canInvite = (permissions & 128) !== 0;
  const canBan = (permissions & 1024) !== 0;
  const canKick = (permissions & 512) !== 0;
  const canMembers = (permissions & (64 | 512 | 1024)) !== 0;
  const client = useQueryClient();
  const key = communityKeys(user.id, community.id);
  const inviteRequest = useRef({ limits: '', id: crypto.randomUUID() });
  const invites = useQuery({ queryKey: [...key, 'invites'], queryFn: ({ signal }) => listInvites(community.id, signal), enabled: canInvite });
  const members = useQuery({ queryKey: [...key, 'members'], queryFn: ({ signal }) => listMembers(community.id, signal), enabled: canMembers });
  const refresh = async () => { await client.invalidateQueries({ queryKey: privateKeys(user.id) }); };
  const create = useMutation({ mutationFn: (limits: { lifetimeHours: number; maxUses: number }) => {
    const serialized = JSON.stringify(limits);
    if (inviteRequest.current.limits !== serialized) inviteRequest.current = { limits: serialized, id: crypto.randomUUID() };
    return createInvite(community.id, { ...limits, clientRequestId: inviteRequest.current.id });
  }, onSuccess: async () => { inviteRequest.current = { limits: '', id: crypto.randomUUID() }; await refresh(); } });
  const revoke = useMutation({ mutationFn: (id: string) => revokeInvite(community.id, id), onSuccess: async revoked => {
    if (create.data?.invite.id === revoked.id) create.reset();
    await refresh();
  } });
  const ban = useMutation({ mutationFn: ({ id, banned }: { id: string; banned: boolean }) => banMember(community.id, id, banned), onSuccess: refresh });
  const kick = useMutation({ mutationFn: (id: string) => kickMember(community.id, id), onSuccess: refresh });
  return <div className="owner-tools">
    {canInvite && <section className="about-panel"><h2>{t("Invite people")}</h2><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); create.mutate({ lifetimeHours: Number(data.get('hours')), maxUses: Number(data.get('uses')) }); }}>
      <div className="invite-limits"><div><label htmlFor="invite-hours">{t("Expires in (hours)")}</label><input id="invite-hours" name="hours" type="number" min={1} max={168} defaultValue={24} required /></div><div><label htmlFor="invite-uses">{t("Maximum uses")}</label><input id="invite-uses" name="uses" type="number" min={1} max={100} defaultValue={10} required /></div></div>
      {create.isError && <p role="alert" className="form-error">{t(create.error.message)}</p>}
      <button className="primary-button" disabled={create.isPending}>{create.isPending ? t("Creating…") : t("Create invitation")}</button>
    </form>
    {create.data && <div className="created-invite"><label htmlFor="created-code">{t("Share this invitation code")}</label><input id="created-code" readOnly value={create.data.code} onFocus={event => event.currentTarget.select()} /><p className="field-hint">{t("Share privately. The code grants community membership.")}</p></div>}
    {invites.isPending ? <p role="status">{t("Loading invitations…")}</p> : invites.isError ? <Recovery error={invites.error} retry={() => void invites.refetch()} />
      : !invites.data || invites.data.length === 0 ? <p className="field-hint">{t("No invitations yet.")}</p> : <ul className="management-list">{invites.data.map(invite => <li key={invite.id}><div><strong>{invite.uses} / {invite.maxUses} {t(" uses")}</strong><span>{invite.revoked ? t("Revoked") : new Date(invite.expiresAt) <= new Date() ? t("Expired") : t("Expires {value}", { value: new Date(invite.expiresAt).toLocaleString(locale) })}</span></div><button className="secondary-button" aria-label={t("Revoke invitation {value}", { value: invite.id.slice(0, 8) })} disabled={invite.revoked || revoke.isPending} onClick={() => revoke.mutate(invite.id)}>{t("Revoke")}</button></li>)}</ul>}
    {revoke.isError && <p role="alert" className="form-error">{t(revoke.error.message)}</p>}
    </section>}
    {canMembers && <section className="about-panel"><h2>{t("Members")}</h2><p className="field-hint">{t("Moderate lower-ranked members. Banned members lose access. Lifting a ban requires them to join again with a usable invitation.")}</p>
      {members.isPending ? <p role="status">{t("Loading members…")}</p> : members.isError ? <Recovery error={members.error} retry={() => void members.refetch()} />
        : <ul className="management-list">{members.data?.map(member => <li key={member.userId}><div><strong>{member.displayName}</strong><span>{member.isOwner ? t("Owner") : t("{value1} · Rank {value2}", { value1: t(member.status), value2: member.rank })}</span></div>{!member.isOwner && member.userId !== user.id && <div>{canBan && <button className="secondary-button" disabled={ban.isPending || Number(member.rank) >= Number(community.rank)} aria-label={member.status === 'Banned' ? t("Lift ban for {value}", { value: member.displayName }) : t("Ban {value}", { value: member.displayName })} onClick={() => ban.mutate({ id: member.userId, banned: member.status !== 'Banned' })}>{member.status === 'Banned' ? t("Lift ban") : t("Ban")}</button>}{canKick && member.status === 'Active' && <button className="secondary-button" disabled={kick.isPending || Number(member.rank) >= Number(community.rank)} aria-label={t("Remove {value}", { value: member.displayName })} onClick={() => kick.mutate(member.userId)}>{t("Remove")}</button>}</div>}</li>)}</ul>}
      {ban.isError && <p role="alert" className="form-error">{t(ban.error.message)}</p>}
      {kick.isError && <p role="alert">{t(kick.error.message)}</p>}
    </section>}
  </div>;
}

function Channel({ community, channelId, user }: { community: CommunityDetails; channelId: string; user: UserProfile }) {
  const { t } = useI18n();
  const channel = useQuery({ queryKey: [...communityKeys(user.id, community.id), 'channel', channelId], queryFn: ({ signal }) => getChannel(community.id, channelId, signal) });
  if (channel.isPending) return <p role="status">{t("Loading channel…")}</p>;
  if (!channel.data) return <Recovery error={channel.error ?? new Error('Channel unavailable.')} retry={() => void channel.refetch()} />;
  const access = community.channels.find(c => c.id === channelId);
  return <section className="channel-workspace chat-workspace"><p className="eyebrow">{t("TEXT CHANNEL")}</p><h2>#{channel.data.name}</h2>{channel.isError && <p role="alert">{t("Channel check interrupted. ")}{t(channel.error.message)}</p>}<MessageTimeline key={`${user.id}:${channelId}`} community={community.id} channel={channelId} user={user} canSend={access?.canSend ?? false} canManageMessages={access?.canManageMessages ?? false} sendDeniedBy={access?.sendDeniedBy ?? null} /></section>;
}

function CommunityView({ id, channelId, user }: { id: string; channelId: string | undefined; user: UserProfile }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [denied, setDenied] = useState(false);
  const key = communityKeys(user.id, id);
  const community = useQuery({ queryKey: [...key, 'details'], queryFn: ({ signal }) => getCommunity(id, signal), enabled: !denied, refetchInterval: 3000 });
  useEffect(() => client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'error') return;
    const queryKey = event.query.queryKey;
    const error = event.query.state.error;
    if (queryKey[0] === 'private' && queryKey[1] === user.id && queryKey[2] === 'community' && queryKey[3] === id &&
      error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      if (error.status === 401 || queryKey[4] === 'details') setDenied(true);
      else void client.invalidateQueries({ queryKey: [...communityKeys(user.id, id), 'details'] });
    }
  }), [client, id, user.id]);
  useEffect(() => {
    if (!community.data) return;
    const visible = new Set(community.data.channels.map(c => c.id));
    const permissions = Number(community.data.permissions);
    const accessible: Record<string, boolean> = { invites: (permissions & 128) !== 0, members: (permissions & (64 | 512 | 1024)) !== 0, access: (permissions & 96) === 96, audit: (permissions & 64) !== 0, voice: community.data.canViewVoice };
    const predicate = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === 'private' && q.queryKey[1] === user.id && q.queryKey[2] === 'community' && q.queryKey[3] === id &&
      (q.queryKey[4] === 'channel' ? !visible.has(String(q.queryKey[5])) : accessible[String(q.queryKey[4])] === false);
    void client.cancelQueries({ predicate }).then(() => client.removeQueries({ predicate }));
  }, [client, community.data, id, user.id]);
  useEffect(() => {
    if (denied) {
      // Disable the observer and remove private detail/channel/management data together.
      void client.cancelQueries({ queryKey: communityKeys(user.id, id) });
      client.removeQueries({ queryKey: communityKeys(user.id, id) });
      void client.invalidateQueries({ queryKey: communityListKey(user.id) });
    }
  }, [client, denied, id, user.id]);
  const leave = useMutation({ mutationFn: () => leaveCommunity(id), onSuccess: async () => {
    await client.cancelQueries({ queryKey: key }); client.removeQueries({ queryKey: key });
    await client.invalidateQueries({ queryKey: communityListKey(user.id) }); navigate('/communities');
  } });
  if (denied || (community.error instanceof ApiError && [401, 403, 404].includes(community.error.status))) return <section className="about-panel"><h1>{t("Community unavailable.")}</h1><p>{t("You may no longer have access, or this community or channel does not exist.")}</p><Link className="about-link" to="/communities">{t("Back to communities")}</Link></section>;
  if (community.isPending) return <p role="status">{t("Loading community…")}</p>;
  if (!community.data) return <Recovery error={community.error ?? new Error('Community unavailable.')} retry={() => void community.refetch()} />;
  const data = community.data;
  return <>
    {community.isError && <div className="message-error"><p role="alert">{t("Community check interrupted. ")}{t(community.error.message)}</p><button className="secondary-button" onClick={() => void community.refetch()}>{t("Retry community check")}</button></div>}
    <Link className="about-link" to="/communities">{t("← Your communities")}</Link>
    <div className="page-heading"><div><p className="eyebrow">{data.role === 'Owner' ? t("YOUR COMMUNITY") : t("COMMUNITY")}</p><h1>{data.name}</h1><p className="page-description">{data.memberCount} {data.memberCount === 1 ? t("member") : t("members")} · {t(data.role)}</p></div>
      {data.role !== 'Owner' && <button className="secondary-button" onClick={() => leave.mutate()} disabled={leave.isPending}>{t("Leave community")}</button>}</div>
    {leave.isError && <p role="alert" className="form-error">{t(leave.error.message)}</p>}
    <VoicePanel community={id} name={data.name} user={user.id} canView={data.canViewVoice} />
    <div className="community-workspace"><nav className="channel-nav" aria-label={t("Community channels")}><h2>{t("Text channels")}</h2>{data.channels.length === 0 && <p>{t("No accessible text channels.")}</p>}{data.channels.map(channel => <Link key={channel.id} to={`/communities/${id}/channels/${channel.id}`} className={channelId === channel.id ? 'selected' : ''}><Hash size={17} aria-hidden="true" /><span>{channel.categoryName && <small>{channel.categoryName} / </small>}{channel.name}</span></Link>)}</nav>
      {channelId ? data.channels.some(c => c.id === channelId) ? <Channel key={channelId} community={data} channelId={channelId} user={user} /> : <section className="channel-workspace"><h2>{t("Channel unavailable.")}</h2><p>{t("Choose another accessible channel.")}</p></section> : <section className="channel-workspace"><Users size={40} aria-hidden="true" /><h2>{t("Welcome to your community.")}</h2><p>{t("Choose a text channel to see your shared space.")}</p></section>}
    </div>
    {(Number(data.permissions) & (64 | 128 | 512 | 1024)) !== 0 && <OwnerTools community={data} user={user} />}
    {(Number(data.permissions) & (32 | 64)) === (32 | 64) && <AccessPanel community={id} user={user.id} />}
    {(Number(data.permissions) & 64) !== 0 && <AuditPanel community={id} user={user.id} />}
  </>;
}

export function CommunitiesPage() { return <AccountGate>{user => <CommunityList key={user.id} user={user} />}</AccountGate>; }
export function CommunityPage() {
  const { id, channelId } = useParams();
  return <AccountGate>{user => <CommunityView key={`${user.id}:${id}`} id={id ?? ''} channelId={channelId} user={user} />}</AccountGate>;
}
