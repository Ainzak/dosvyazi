import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { communityKeys, getAccess, listMembers, saveAccess } from '../../api/communities';
import type { AccessPolicy, MemberSummary } from '../../api/communities';
import { ApiError } from '../../api/http';

type Rule = AccessPolicy['channelRules'][number];
const permissions = [{ bit: 1, name: 'ViewChannel' }, { bit: 2, name: 'SendMessage' }, { bit: 4, name: 'ManageMessages' }, { bit: 32, name: 'ManageChannels' }, { bit: 64, name: 'ManageRoles' }, { bit: 128, name: 'ManageInvites' }, { bit: 512, name: 'KickMembers' }, { bit: 1024, name: 'BanMembers' }, { bit: 2048, name: 'ConnectVoice' }, { bit: 4096, name: 'SpeakVoice' }, { bit: 8192, name: 'ModerateVoice' }];

function PolicyEditor({ initial, members, community, user, reload }: { initial: AccessPolicy; members: MemberSummary[]; community: string; user: string; reload: () => Promise<void> }) {
  const client = useQueryClient();
  const [policy, setPolicy] = useState(initial);
  const [role, setRole] = useState(community);
  const [kind, setKind] = useState<'channelRules' | 'categoryRules' | 'voiceRules'>('channelRules');
  const [resource, setResource] = useState(initial.channels[0]?.id ?? '');
  const command = useRef({ payload: '', id: crypto.randomUUID() });
  const save = useMutation({ mutationFn: () => {
    const payload = JSON.stringify(policy);
    if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() };
    return saveAccess(community, command.current.id, policy);
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: communityKeys(user, community) }); await reload(); } });
  const selectedRole = policy.roles.find(r => r.id === role)!;
  const resources = kind === 'channelRules' ? policy.channels : kind === 'voiceRules' ? [{ id: community, name: 'Voice room' }] : policy.categories;
  const rule = (policy[kind] ?? []).find(r => r.resourceId === resource && r.roleId === role);
  const updateRule = (bit: number, value: string) => setPolicy(current => {
    const existing = (current[kind] ?? []).find(r => r.resourceId === resource && r.roleId === role) ?? { resourceId: resource, roleId: role, allow: 0, deny: 0 };
    const next: Rule = { ...existing, allow: Number(existing.allow) & ~bit, deny: Number(existing.deny) & ~bit };
    if (value === 'Allow') next.allow = Number(next.allow) | bit;
    if (value === 'Deny') next.deny = Number(next.deny) | bit;
    return { ...current, [kind]: [...(current[kind] ?? []).filter(r => r.resourceId !== resource || r.roleId !== role), next] };
  });
  const add = (type: 'roles' | 'categories' | 'channels', name: string) => {
    const id = crypto.randomUUID();
    setPolicy(p => type === 'roles' ? { ...p, roles: [...p.roles, { id, name: name.trim(), grants: 0, rank: 1 }] }
      : type === 'categories' ? { ...p, categories: [...p.categories, { id, name: name.trim() }] }
        : { ...p, channels: [...p.channels, { id, name: name.trim(), categoryId: null }] });
  };
  return <div className="access-editor">
    <p className="field-hint">Everyone applies to all members. All role grants and resource allows combine, then every explicit Deny wins. The owner keeps management access. Voice access changes may reconnect everyone after confirmation.</p>
    <p className="field-hint">Managers need ManageRoles and ManageChannels here. They can change lower-ranked roles and members, and grant only permissions they hold. Management permissions do not grant private message access.</p>
    <p className="field-hint">For a private channel, remove ViewChannel from everyone, allow everyone on public channels, then allow an assigned role on the private channel. Denying everyone also denies assigned roles.</p>
    <fieldset disabled={save.isPending}><legend>Roles and base permissions</legend>
      <label>Selected role<select aria-label="Selected role" value={role} onChange={e => setRole(e.target.value)}>{policy.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>Role rank<input aria-label="Role rank" type="number" min={role === community ? 0 : 1} max={1000} value={selectedRole.rank} disabled={role === community} onChange={e => setPolicy(p => ({ ...p, roles: p.roles.map(r => r.id === role ? { ...r, rank: Number(e.target.value) } : r) }))} /></label>
      {permissions.map(p => <label className="access-checkbox" key={p.bit}><input type="checkbox" checked={(Number(selectedRole.grants) & p.bit) !== 0} onChange={e => setPolicy(current => ({ ...current, roles: current.roles.map(r => r.id === role ? { ...r, grants: e.target.checked ? Number(r.grants) | p.bit : Number(r.grants) & ~p.bit } : r) }))} />Grant {p.name}</label>)}
    </fieldset>
    {(['roles', 'categories', 'channels'] as const).map(type => <form key={type} onSubmit={e => { e.preventDefault(); const form = e.currentTarget; add(type, String(new FormData(form).get('name'))); form.reset(); }}>
      <label htmlFor={`new-${type}`}>New {type === 'roles' ? 'role' : type === 'categories' ? 'category' : 'text channel'}</label><div className="access-add"><input id={`new-${type}`} name="name" required maxLength={80} disabled={save.isPending} /><button className="secondary-button" disabled={save.isPending || policy[type].length >= (type === 'channels' ? 50 : 20)}>Add {type === 'roles' ? 'role' : type === 'categories' ? 'category' : 'channel'}</button></div>
    </form>)}
    <fieldset disabled={save.isPending}><legend>Channel categories</legend>{policy.channels.map(c => <label key={c.id}>{c.name}<select aria-label={`Category for ${c.name}`} value={c.categoryId ?? ''} onChange={e => setPolicy(p => ({ ...p, channels: p.channels.map(channel => channel.id === c.id ? { ...channel, categoryId: e.target.value || null } : channel) }))}><option value="">No category</option>{policy.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>)}</fieldset>
    <label>Voice category<select aria-label="Voice category" value={policy.voiceCategoryId ?? ''} onChange={e => setPolicy(p => ({ ...p, voiceCategoryId: e.target.value || null }))}><option value="">No category</option>{policy.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <fieldset disabled={save.isPending}><legend>Rules for {selectedRole.name}</legend>
      <label>Resource type<select aria-label="Resource type" value={kind} onChange={e => { const next = e.target.value as typeof kind; setKind(next); setResource(next === 'voiceRules' ? community : (next === 'channelRules' ? policy.channels : policy.categories)[0]?.id ?? ''); }}><option value="channelRules">Channel</option><option value="categoryRules">Category</option><option value="voiceRules">Voice</option></select></label>
      <label>Resource<select aria-label="Resource" value={resource} onChange={e => setResource(e.target.value)}>{resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      {resources.length === 0 ? <p>No categories yet.</p> : permissions.filter(p => (p.bit & (kind === 'channelRules' ? 39 : kind === 'voiceRules' ? 14369 : 14375)) !== 0).map(p => <label key={p.bit}>{p.name} rule<select aria-label={`${p.name} rule`} value={(Number(rule?.deny ?? 0) & p.bit) !== 0 ? 'Deny' : (Number(rule?.allow ?? 0) & p.bit) !== 0 ? 'Allow' : 'Inherit'} onChange={e => updateRule(p.bit, e.target.value)}><option>Inherit</option><option>Allow</option><option>Deny</option></select></label>)}
    </fieldset>
    <fieldset disabled={save.isPending}><legend>Member roles</legend>{members.filter(m => m.status === 'Active' && !m.isOwner).map(m => <div className="access-member" key={m.userId}><strong>{m.displayName}</strong>{policy.roles.filter(r => r.id !== community).map(r => <label className="access-checkbox" key={r.id}><input type="checkbox" aria-label={`${r.name} for ${m.displayName}`} checked={policy.members.find(member => member.userId === m.userId)?.roleIds.includes(r.id) ?? false} onChange={e => setPolicy(p => {
      const current = p.members.find(member => member.userId === m.userId)?.roleIds ?? [];
      return { ...p, members: [...p.members.filter(member => member.userId !== m.userId), { userId: m.userId, roleIds: e.target.checked ? [...current, r.id] : current.filter(id => id !== r.id) }] };
    })} />{r.name}</label>)}</div>)}{members.filter(m => m.status === 'Active' && !m.isOwner).length === 0 && <p>No other active members.</p>}</fieldset>
    {save.isError && <p role="alert">{save.error.message} Reload discards unsaved edits.</p>}
    <div className="access-actions"><button className="primary-button" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving access…' : 'Save access'}</button><button className="secondary-button" disabled={save.isPending} onClick={reload}>Reload access</button></div>
  </div>;
}

export function AccessPanel({ community, user }: { community: string; user: string }) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const policy = useQuery({ queryKey: [...communityKeys(user, community), 'access'], queryFn: ({ signal }) => getAccess(community, signal), enabled: open });
  const members = useQuery({ queryKey: [...communityKeys(user, community), 'members'], queryFn: ({ signal }) => listMembers(community, signal), enabled: open });
  const reload = async () => { const results = await Promise.all([policy.refetch(), members.refetch()]); if (results.every(r => !r.isError)) setRevision(r => r + 1); };
  const denied = [policy.error, members.error].some(e => e instanceof ApiError && [401, 403, 404].includes(e.status));
  return <section className="about-panel access-panel"><h2>Access</h2><button className="secondary-button" onClick={() => setOpen(value => !value)}>{open ? 'Close access' : 'Manage access'}</button>{open && <>
    {(policy.isPending || members.isPending) && <p role="status">Loading text access…</p>}
    {(policy.isError || members.isError) && <p role="alert">{policy.error?.message ?? members.error?.message}<button className="secondary-button" onClick={reload}>Retry access</button></p>}
    {!denied && policy.data && members.data && <PolicyEditor key={revision} initial={policy.data} members={members.data} community={community} user={user} reload={reload} />}
  </>}</section>;
}
