import { useI18n } from '../../i18n/LocaleContext';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { communityKeys, getAccess, listMembers, saveAccess } from '../../api/communities';
import type { AccessPolicy, MemberSummary } from '../../api/communities';
import { ApiError } from '../../api/http';
import { ConfirmAction } from '../../layout/ConfirmAction';

type Rule = AccessPolicy['channelRules'][number];
const permissions = [{ bit: 1, name: 'ViewChannel' }, { bit: 2, name: 'SendMessage' }, { bit: 4, name: 'ManageMessages' }, { bit: 32, name: 'ManageChannels' }, { bit: 64, name: 'ManageRoles' }, { bit: 128, name: 'ManageInvites' }, { bit: 512, name: 'KickMembers' }, { bit: 1024, name: 'BanMembers' }, { bit: 2048, name: 'ConnectVoice' }, { bit: 4096, name: 'SpeakVoice' }, { bit: 8192, name: 'ModerateVoice' }, { bit: 16384, name: 'ShareScreen' }, { bit: 32768, name: 'UseCamera' }];

function PolicyEditor({ initial, members, community, user, reload, onDirty, onBusy }: { initial: AccessPolicy; members: MemberSummary[]; community: string; user: string; reload: () => Promise<void>; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [policy, setPolicy] = useState(initial);
  const [role, setRole] = useState(community);
  const [kind, setKind] = useState<'channelRules' | 'categoryRules' | 'voiceRules'>('channelRules');
  const [resource, setResource] = useState(initial.channels[0]?.id ?? '');
  const command = useRef({ payload: '', id: crypto.randomUUID() });
  const [baseline] = useState(() => JSON.stringify(initial)); const dirty = JSON.stringify(policy) !== baseline;
  const roleSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => { roleSelect.current?.focus(); }, []);
  const save = useMutation({ mutationFn: () => {
    const payload = JSON.stringify(policy);
    if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() };
    return saveAccess(community, command.current.id, policy);
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: communityKeys(user, community) }); await reload(); } });
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onBusy(save.isPending); }, [save.isPending, onBusy]);
  const selectedRole = policy.roles.find(r => r.id === role)!;
  const resources = kind === 'channelRules' ? policy.channels : kind === 'voiceRules' ? [{ id: community, name: t('Voice room') }] : policy.categories;
  const rule = (policy[kind] ?? []).find(r => r.resourceId === resource && r.roleId === role);
  const updateRule = (bit: number, value: string) => setPolicy(current => {
    const existing = (current[kind] ?? []).find(r => r.resourceId === resource && r.roleId === role) ?? { resourceId: resource, roleId: role, allow: 0, deny: 0 };
    const next: Rule = { ...existing, allow: Number(existing.allow) & ~bit, deny: Number(existing.deny) & ~bit };
    if (value === 'Allow') next.allow = Number(next.allow) | bit;
    if (value === 'Deny') next.deny = Number(next.deny) | bit;
    return { ...current, [kind]: [...(current[kind] ?? []).filter(r => r.resourceId !== resource || r.roleId !== role), next] };
  });
  const add = (type: 'roles' | 'categories' | 'channels', name: string, channelKind = 'Text') => {
    const id = crypto.randomUUID();
    setPolicy(p => type === 'roles' ? { ...p, roles: [...p.roles, { id, name: name.trim(), grants: 0, rank: 1 }] }
      : type === 'categories' ? { ...p, categories: [...p.categories, { id, name: name.trim() }] }
        : { ...p, channels: [...p.channels, { id, name: name.trim(), categoryId: null, kind: channelKind }] });
  };
  return <div className="access-editor">
    <details className="access-help"><summary>{t('How permissions work')}</summary><p className="field-hint">{t("Everyone applies to all members. All role grants and resource allows combine, then every explicit Deny wins. The owner keeps management access. Voice access changes may reconnect everyone after confirmation.")}</p>
    <p className="field-hint">{t("Managers need ManageRoles and ManageChannels here. They can change lower-ranked roles and members, and grant only permissions they hold. Management permissions do not grant private message access.")}</p>
    <p className="field-hint">{t("For a private channel, remove ViewChannel from everyone, allow everyone on public channels, then allow an assigned role on the private channel. Denying everyone also denies assigned roles.")}</p></details>
    <p className={`access-draft-state${dirty ? ' is-dirty' : ''}`} role="status">{t(dirty ? 'Unsaved access changes' : 'Access settings loaded')}</p>
    <fieldset className="access-role-permissions" disabled={save.isPending}><legend>{t("Roles and base permissions")}</legend>
      <label>{t("Selected role")}<select ref={roleSelect} aria-label={t("Selected role")} value={role} onChange={e => setRole(e.target.value)}>{policy.roles.map(r => <option key={r.id} value={r.id}>{'kind' in r && r.kind === 'Forum' && `${t('Forum')}: `}{r.name}</option>)}</select></label>
      <label>{t("Role rank")}<input aria-label={t("Role rank")} type="number" min={role === community ? 0 : 1} max={1000} value={selectedRole.rank} disabled={role === community} onChange={e => setPolicy(p => ({ ...p, roles: p.roles.map(r => r.id === role ? { ...r, rank: Number(e.target.value) } : r) }))} /></label>
      {permissions.map(p => <label className="access-checkbox" key={p.bit}><input type="checkbox" checked={(Number(selectedRole.grants) & p.bit) !== 0} onChange={e => setPolicy(current => ({ ...current, roles: current.roles.map(r => r.id === role ? { ...r, grants: e.target.checked ? Number(r.grants) | p.bit : Number(r.grants) & ~p.bit } : r) }))} />{t("Grant ")}{t(p.name)}</label>)}
    </fieldset>
    <div className="access-create-resources">{(['roles', 'categories', 'channels'] as const).map(type => <form key={type} onSubmit={e => { e.preventDefault(); const form = e.currentTarget; add(type, String(new FormData(form).get('name'))); form.reset(); }}>
      <label htmlFor={`new-${type}`}>{t(type === 'roles' ? 'New role' : type === 'categories' ? 'New category' : 'New text channel')}</label><div className="access-add"><input id={`new-${type}`} name="name" required maxLength={80} disabled={save.isPending} /><button className="secondary-button" disabled={save.isPending || policy[type].length >= (type === 'channels' ? 50 : 20)}>{t(type === 'roles' ? 'Add role' : type === 'categories' ? 'Add category' : 'Add channel')}</button></div>
    </form>)}<form onSubmit={e => { e.preventDefault(); add('channels', String(new FormData(e.currentTarget).get('name')), 'Forum'); e.currentTarget.reset(); }}><label htmlFor="new-forum">{t('New forum')}</label><div className="access-add"><input id="new-forum" name="name" required maxLength={80} disabled={save.isPending} /><button className="secondary-button" disabled={save.isPending || policy.channels.length >= 50}>{t('Add forum')}</button></div></form></div>
    <fieldset disabled={save.isPending}><legend>{t("Channel categories")}</legend>{policy.channels.map(c => <label key={c.id}>{c.kind === 'Forum' && `${t('Forum')}: `}{c.name}<select aria-label={t("Category for {value}", { value: c.name })} value={c.categoryId ?? ''} onChange={e => setPolicy(p => ({ ...p, channels: p.channels.map(channel => channel.id === c.id ? { ...channel, categoryId: e.target.value || null } : channel) }))}><option value="">{t("No category")}</option>{policy.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>)}</fieldset>
    <label>{t("Voice category")}<select aria-label={t("Voice category")} disabled={save.isPending} value={policy.voiceCategoryId ?? ''} onChange={e => setPolicy(p => ({ ...p, voiceCategoryId: e.target.value || null }))}><option value="">{t("No category")}</option>{policy.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <fieldset className="access-resource-rules" disabled={save.isPending}><legend>{t("Rules for ")}{selectedRole.name}</legend>
      <label>{t("Resource type")}<select aria-label={t("Resource type")} value={kind} onChange={e => { const next = e.target.value as typeof kind; setKind(next); setResource(next === 'voiceRules' ? community : (next === 'channelRules' ? policy.channels : policy.categories)[0]?.id ?? ''); }}><option value="channelRules">{t("Channel")}</option><option value="categoryRules">{t("Category")}</option><option value="voiceRules">{t("Voice")}</option></select></label>
      <label>{t("Resource")}<select aria-label={t("Resource")} value={resource} onChange={e => setResource(e.target.value)}>{resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      {resources.length === 0 ? <p>{t("No categories yet.")}</p> : permissions.filter(p => (p.bit & (kind === 'channelRules' ? 39 : kind === 'voiceRules' ? 63521 : 63527)) !== 0).map(p => <label key={p.bit}>{t(p.name)} {t(" rule")}<select aria-label={t("{value} rule", { value: t(p.name) })} value={(Number(rule?.deny ?? 0) & p.bit) !== 0 ? 'Deny' : (Number(rule?.allow ?? 0) & p.bit) !== 0 ? 'Allow' : 'Inherit'} onChange={e => updateRule(p.bit, e.target.value)}><option value="Inherit">{t("Inherit")}</option><option value="Allow">{t("Allow")}</option><option value="Deny">{t("Deny")}</option></select></label>)}
    </fieldset>
    <fieldset disabled={save.isPending}><legend>{t("Member roles")}</legend>{members.filter(m => m.status === 'Active' && !m.isOwner).map(m => <div className="access-member" key={m.userId}><strong>{m.displayName}</strong>{policy.roles.filter(r => r.id !== community).map(r => <label className="access-checkbox" key={r.id}><input type="checkbox" aria-label={t("{value1} for {value2}", { value1: r.name, value2: m.displayName })} checked={policy.members.find(member => member.userId === m.userId)?.roleIds.includes(r.id) ?? false} onChange={e => setPolicy(p => {
      const current = p.members.find(member => member.userId === m.userId)?.roleIds ?? [];
      return { ...p, members: [...p.members.filter(member => member.userId !== m.userId), { userId: m.userId, roleIds: e.target.checked ? [...current, r.id] : current.filter(id => id !== r.id) }] };
    })} />{r.name}</label>)}</div>)}{members.filter(m => m.status === 'Active' && !m.isOwner).length === 0 && <p>{t("No other active members.")}</p>}</fieldset>
    {save.isError && <p role="alert">{t(save.error.message)} {t(" Reload discards unsaved edits.")}</p>}
    <div className="access-actions"><button className="primary-button" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? t("Saving access…") : t("Save access")}</button>{dirty ? <ConfirmAction label={t('Reload access')} title={t('Discard unsaved access changes?')} description={t('Reloading replaces your draft with the latest saved permissions.')} disabled={save.isPending} confirmLabel={t('Discard and reload')} onConfirm={() => void reload()} /> : <button className="secondary-button" disabled={save.isPending} onClick={reload}>{t("Reload access")}</button>}</div>
  </div>;
}

export function AccessPanel({ community, user }: { community: string; user: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const closeEditor = () => { setOpen(false); setDirty(false); requestAnimationFrame(() => openButton.current?.focus()); };
  const policy = useQuery({ queryKey: [...communityKeys(user, community), 'access'], queryFn: ({ signal }) => getAccess(community, signal), enabled: open });
  const members = useQuery({ queryKey: [...communityKeys(user, community), 'members'], queryFn: ({ signal }) => listMembers(community, signal), enabled: open });
  const reload = async () => { const results = await Promise.all([policy.refetch(), members.refetch()]); if (results.every(r => !r.isError)) setRevision(r => r + 1); };
  const denied = [policy.error, members.error].some(e => e instanceof ApiError && [401, 403, 404].includes(e.status));
  return <section id="community-access" className="about-panel access-panel"><div className="settings-section-heading"><div><h2>{t("Access")}</h2><p className="field-hint">{t('Roles, categories and channel rules')}</p></div>{open && dirty ? <ConfirmAction label={t('Close access')} title={t('Discard unsaved access changes?')} description={t('Closing the editor discards your unsaved permission changes.')} confirmLabel={t('Discard and close')} disabled={busy} onConfirm={closeEditor} /> : <button ref={openButton} className="secondary-button" disabled={busy} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? t("Close access") : t("Manage access")}</button>}</div>{open && <>
    {(policy.isPending || members.isPending) && <p role="status">{t("Loading text access…")}</p>}
    {(policy.isError || members.isError) && <p role="alert">{t(policy.error?.message ?? members.error?.message)}<button className="secondary-button" onClick={reload}>{t("Retry access")}</button></p>}
    {!denied && policy.data && members.data && <PolicyEditor key={revision} initial={policy.data} members={members.data} community={community} user={user} reload={reload} onDirty={setDirty} onBusy={setBusy} />}
  </>}</section>;
}
