import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Hash, Users } from 'lucide-react';
import type { UserProfile } from '../../api/accounts';
import { ApiError } from '../../api/http';
import { banMember, communityKeys, communityListKey, createCommunity, createInvite, getChannel, getCommunity,
  joinCommunity, leaveCommunity, listCommunities, listInvites, listMembers, privateKeys, revokeInvite } from '../../api/communities';
import type { CommunityDetails } from '../../api/communities';
import { useSession } from '../accounts/useSession';

function Recovery({ title = 'Connection interrupted.', error, retry }: { title?: string; error: Error; retry: () => void }) {
  return <section className="about-panel"><h1>{title}</h1><p role="alert">{error.message}</p><button className="secondary-button" onClick={retry}>Try again</button></section>;
}

function AccountGate({ children }: { children: (user: UserProfile) => ReactNode }) {
  const session = useSession();
  if (session.isPending) return <p role="status">Checking your session…</p>;
  if (session.isError) return <Recovery error={session.error} retry={() => void session.refetch()} />;
  if (!session.data) return <section className="about-panel"><h1>A place for your people.</h1><p>Sign in to create a community or join with an invitation.</p><Link className="about-link" to="/login">Sign in</Link></section>;
  return children(session.data);
}

function CommunityList({ user }: { user: UserProfile }) {
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
    <div className="page-heading"><div><p className="eyebrow">YOUR COMMUNITIES</p><h1>A place for your people.</h1><p className="page-description">Create a shared space, or join one with an invitation.</p></div></div>
    <div className="community-forms">
      <section className="about-panel"><h2>Create a community</h2><form onSubmit={event => { event.preventDefault(); create.mutate(String(new FormData(event.currentTarget).get('name') ?? '').trim()); }}>
        <label htmlFor="community-name">Community name</label><input id="community-name" name="name" minLength={2} maxLength={80} required />
        <p className="field-hint">A general text channel is included. Only members can see your community.</p>
        {create.isError && <p role="alert" className="form-error">{create.error.message}</p>}
        <button className="primary-button" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create community'}</button>
      </form></section>
      <section className="about-panel"><h2>Join a community</h2><form onSubmit={event => { event.preventDefault(); join.mutate(String(new FormData(event.currentTarget).get('code') ?? '').trim()); }}>
        <label htmlFor="join-code">Invitation code</label><input id="join-code" name="code" type="password" autoComplete="off" minLength={64} maxLength={64} required />
        <p className="field-hint">Ask the community owner for a code. Codes can expire or run out of uses.</p>
        {join.isError && <p role="alert" className="form-error">{join.error.message}</p>}
        <button className="primary-button" disabled={join.isPending}>{join.isPending ? 'Joining…' : 'Join community'}</button>
      </form></section>
    </div>
    <section className="community-directory" aria-labelledby="communities-heading"><h2 id="communities-heading">Your shared spaces</h2>
      {list.isPending ? <p role="status">Loading communities…</p> : list.isError ? <Recovery error={list.error} retry={() => void list.refetch()} />
        : list.data.length === 0 ? <div className="empty-community"><Users aria-hidden="true" /><h3>No communities yet.</h3><p>Create your first community or use an invitation above.</p></div>
          : <div className="community-cards">{list.data.map(community => <Link className="community-card" key={community.id} to={`/communities/${community.id}`}><Users size={22} aria-hidden="true" /><div><h3>{community.name}</h3><span>{community.role}</span></div></Link>)}</div>}
    </section>
  </>;
}

function OwnerTools({ community, user }: { community: CommunityDetails; user: UserProfile }) {
  const client = useQueryClient();
  const key = communityKeys(user.id, community.id);
  const inviteRequest = useRef({ limits: '', id: crypto.randomUUID() });
  const invites = useQuery({ queryKey: [...key, 'invites'], queryFn: ({ signal }) => listInvites(community.id, signal) });
  const members = useQuery({ queryKey: [...key, 'members'], queryFn: ({ signal }) => listMembers(community.id, signal) });
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
  return <div className="owner-tools">
    <section className="about-panel"><h2>Invite people</h2><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); create.mutate({ lifetimeHours: Number(data.get('hours')), maxUses: Number(data.get('uses')) }); }}>
      <div className="invite-limits"><div><label htmlFor="invite-hours">Expires in (hours)</label><input id="invite-hours" name="hours" type="number" min={1} max={168} defaultValue={24} required /></div><div><label htmlFor="invite-uses">Maximum uses</label><input id="invite-uses" name="uses" type="number" min={1} max={100} defaultValue={10} required /></div></div>
      {create.isError && <p role="alert" className="form-error">{create.error.message}</p>}
      <button className="primary-button" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create invitation'}</button>
    </form>
    {create.data && <div className="created-invite"><label htmlFor="created-code">Share this invitation code</label><input id="created-code" readOnly value={create.data.code} onFocus={event => event.currentTarget.select()} /><p className="field-hint">Share privately. The code grants community membership.</p></div>}
    {invites.isPending ? <p role="status">Loading invitations…</p> : invites.isError ? <Recovery error={invites.error} retry={() => void invites.refetch()} />
      : invites.data.length === 0 ? <p className="field-hint">No invitations yet.</p> : <ul className="management-list">{invites.data.map(invite => <li key={invite.id}><div><strong>{invite.uses} / {invite.maxUses} uses</strong><span>{invite.revoked ? 'Revoked' : new Date(invite.expiresAt) <= new Date() ? 'Expired' : `Expires ${new Date(invite.expiresAt).toLocaleString('en')}`}</span></div><button className="secondary-button" aria-label={`Revoke invitation ${invite.id.slice(0, 8)}`} disabled={invite.revoked || revoke.isPending} onClick={() => revoke.mutate(invite.id)}>Revoke</button></li>)}</ul>}
    {revoke.isError && <p role="alert" className="form-error">{revoke.error.message}</p>}
    </section>
    <section className="about-panel"><h2>Members</h2><p className="field-hint">Banned members lose access. Lifting a ban requires them to join again with a usable invitation.</p>
      {members.isPending ? <p role="status">Loading members…</p> : members.isError ? <Recovery error={members.error} retry={() => void members.refetch()} />
        : <ul className="management-list">{members.data.map(member => <li key={member.userId}><div><strong>{member.displayName}</strong><span>{member.isOwner ? 'Owner' : member.status}</span></div>{!member.isOwner && <button className="secondary-button" disabled={ban.isPending} aria-label={member.status === 'Banned' ? `Lift ban for ${member.displayName}` : `Ban ${member.displayName}`} onClick={() => ban.mutate({ id: member.userId, banned: member.status !== 'Banned' })}>{member.status === 'Banned' ? 'Lift ban' : 'Ban'}</button>}</li>)}</ul>}
      {ban.isError && <p role="alert" className="form-error">{ban.error.message}</p>}
    </section>
  </div>;
}

function Channel({ community, channelId, user }: { community: CommunityDetails; channelId: string; user: UserProfile }) {
  const channel = useQuery({ queryKey: [...communityKeys(user.id, community.id), 'channel', channelId], queryFn: ({ signal }) => getChannel(community.id, channelId, signal) });
  if (channel.isPending) return <p role="status">Loading channel…</p>;
  if (channel.isError) return <Recovery error={channel.error} retry={() => void channel.refetch()} />;
  return <section className="channel-workspace"><p className="eyebrow">TEXT CHANNEL</p><h2>#{channel.data.name}</h2><Hash size={40} aria-hidden="true" /><h3>Your shared space is ready.</h3><p>Text messaging is coming next.</p></section>;
}

function CommunityView({ id, channelId, user }: { id: string; channelId: string | undefined; user: UserProfile }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [denied, setDenied] = useState(false);
  const key = communityKeys(user.id, id);
  const community = useQuery({ queryKey: [...key, 'details'], queryFn: ({ signal }) => getCommunity(id, signal), enabled: !denied });
  useEffect(() => client.getQueryCache().subscribe(event => {
    const queryKey = event.query.queryKey;
    const error = event.query.state.error;
    if (queryKey[0] === 'private' && queryKey[1] === user.id && queryKey[2] === 'community' && queryKey[3] === id &&
      error instanceof ApiError && [401, 403, 404].includes(error.status)) setDenied(true);
  }), [client, id, user.id]);
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
  if (denied || (community.error instanceof ApiError && [401, 403, 404].includes(community.error.status))) return <section className="about-panel"><h1>Community unavailable.</h1><p>You may no longer have access, or this community or channel does not exist.</p><Link className="about-link" to="/communities">Back to communities</Link></section>;
  if (community.isPending) return <p role="status">Loading community…</p>;
  if (community.isError) return <Recovery error={community.error} retry={() => void community.refetch()} />;
  const data = community.data;
  return <>
    <Link className="about-link" to="/communities">← Your communities</Link>
    <div className="page-heading"><div><p className="eyebrow">{data.role === 'Owner' ? 'YOUR COMMUNITY' : 'COMMUNITY'}</p><h1>{data.name}</h1><p className="page-description">{data.memberCount} {data.memberCount === 1 ? 'member' : 'members'} · {data.role}</p></div>
      {data.role !== 'Owner' && <button className="secondary-button" onClick={() => leave.mutate()} disabled={leave.isPending}>Leave community</button>}</div>
    {leave.isError && <p role="alert" className="form-error">{leave.error.message}</p>}
    <div className="community-workspace"><nav className="channel-nav" aria-label="Community channels"><h2>Text channels</h2>{data.channels.map(channel => <Link key={channel.id} to={`/communities/${id}/channels/${channel.id}`} className={channelId === channel.id ? 'selected' : ''}><Hash size={17} aria-hidden="true" />{channel.name}</Link>)}</nav>
      {channelId ? <Channel community={data} channelId={channelId} user={user} /> : <section className="channel-workspace"><Users size={40} aria-hidden="true" /><h2>Welcome to your community.</h2><p>Choose a text channel to see your shared space.</p></section>}
    </div>
    {data.role === 'Owner' && <OwnerTools community={data} user={user} />}
  </>;
}

export function CommunitiesPage() { return <AccountGate>{user => <CommunityList key={user.id} user={user} />}</AccountGate>; }
export function CommunityPage() {
  const { id, channelId } = useParams();
  return <AccountGate>{user => <CommunityView key={`${user.id}:${id}`} id={id ?? ''} channelId={channelId} user={user} />}</AccountGate>;
}
