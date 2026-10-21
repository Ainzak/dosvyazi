import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { explainRights, exportConfiguration, previewConfiguration, restoreConfiguration } from '../../api/administration';
import type { CommunityConfiguration } from '../../api/administration';
import { communityKeys, communityListKey, listMembers } from '../../api/communities';
import type { CommunityDetails } from '../../api/communities';
import { useI18n } from '../../i18n/LocaleContext';
import { ConfirmAction } from '../../layout/ConfirmAction';

const bits = [{ bit: 1, key: 'ViewChannel' }, { bit: 2, key: 'SendMessage' }, { bit: 4, key: 'ManageMessages' }, { bit: 32, key: 'ManageChannels' }, { bit: 64, key: 'ManageRoles' }, { bit: 128, key: 'ManageInvites' }, { bit: 512, key: 'KickMembers' }, { bit: 1024, key: 'BanMembers' }, { bit: 2048, key: 'ConnectVoice' }, { bit: 4096, key: 'SpeakVoice' }, { bit: 8192, key: 'ModerateVoice' }, { bit: 16384, key: 'ShareScreen' }, { bit: 32768, key: 'UseCamera' }];

export function RightsPanel({ community, user }: { community: CommunityDetails; user: string }) {
  const { t } = useI18n(); const [open, setOpen] = useState(false); const [resource, setResource] = useState(community.canViewVoice ? 'voice' : community.channels[0]?.id ?? ''); const [target, setTarget] = useState(user);
  const manager = (Number(community.permissions) & 96) === 96;
  const selectedTarget = manager ? target : user;
  const visible = resource === 'voice' ? community.canViewVoice : community.channels.some(c => c.id === resource);
  const members = useQuery({ queryKey: [...communityKeys(user, community.id), 'members'], queryFn: ({ signal }) => listMembers(community.id, signal), enabled: open && manager });
  const query = useQuery({ queryKey: [...communityKeys(user, community.id), 'rights', resource, selectedTarget], queryFn: ({ signal }) => explainRights(community.id, resource === 'voice' ? 'voice' : 'text', resource === 'voice' ? '' : resource, selectedTarget, signal), enabled: open && visible, refetchInterval: 5000 });
  return <section className="about-panel administration-panel"><h2>{t('Explain access')}</h2><p className="field-hint">{t('Inspect saved permissions. Changes in the access editor apply only after saving.')}</p><button className="secondary-button" aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? 'Hide access explanation' : 'Show access explanation')}</button>{open && <>
    <label>{t('Resource')}<select aria-label={t('Explain access to')} value={resource} onChange={e => setResource(e.target.value)}>{community.canViewVoice && <option value="voice">{t('Voice room')}</option>}{community.channels.map(c => <option key={c.id} value={c.id}>{c.kind === 'Forum' ? t('Forum') + ': ' : '#'}{c.name}</option>)}</select></label>
    {manager && <label>{t('Member')}<select aria-label={t('Explain access for')} value={target} onChange={e => setTarget(e.target.value)}><option value={user}>{t('Me')}</option>{!members.isError && members.data?.filter(m => m.status === 'Active' && m.userId !== user).map(m => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}</select></label>}
    {members.isError && manager && <p role="alert">{t(members.error.message)}</p>}
    {!visible && <p>{t('Choose another accessible channel.')}</p>}{visible && query.isPending && <p role="status">{t('Checking permissions…')}</p>}{visible && query.isError && <p role="alert">{t(query.error.message)} <button className="secondary-button" onClick={() => void query.refetch()}>{t('Try again')}</button></p>}
    {visible && !query.isError && query.data && <div className="rights-result"><p>{t('Saved policy version: {value}', { value: query.data.version })}</p>{query.data.ownerOverride && <p>{t('The owner has all supported permissions, including access to private resources.')}</p>}<p className="field-hint">{t('Role grants and explicit allows combine. Any explicit deny wins. Sending requires viewing; speaking requires viewing and connecting; sharing also requires speaking. Member rank and the specific action can impose additional restrictions.')}</p>
      <ul className="rights-decisions">{query.data.decisions.map(d => <li key={d.permission}><strong>{t(d.permission)}</strong><span className={d.allowed ? 'permission-allowed' : 'form-error'}>{t(d.allowed ? 'Allowed' : 'Denied')}</span>{!d.allowed && <small>{t('Required permissions: ')}{bits.filter(b => (b.bit & Number(d.required)) !== 0).map(b => t(b.key)).join(', ')}</small>}</li>)}</ul>
      <details><summary>{t('Sources of these permissions')}</summary><ul>{query.data.sources.map((s, i) => <li key={i}><strong>{t(s.scope === 'role' ? 'Role' : s.scope === 'category' ? 'Category' : s.scope === 'voice' ? 'Voice' : s.scope === 'discussion' ? 'Discussion state' : 'Channel')}: {s.role}</strong><p>{t('Allows: ')}{bits.filter(b => (Number(s.allow) & b.bit) !== 0).map(b => t(b.key)).join(', ') || t('None')}</p><p>{t('Denies: ')}{bits.filter(b => (Number(s.deny) & b.bit) !== 0).map(b => t(b.key)).join(', ') || t('None')}</p></li>)}</ul></details>
    </div>}
  </>}</section>;
}

export function ConfigurationExport({ community }: { community: string }) {
  const { t } = useI18n();
  const download = useMutation({ mutationFn: () => exportConfiguration(community), onSuccess: document => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
    const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = 'dosvyazi-community-v1.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  return <section className="about-panel administration-panel"><h2>{t('Community configuration')}</h2><p>{t('Export roles, categories, channels and access rules. The file contains private resource names. Share it only with people you trust.')}</p><p className="field-hint">{t('Accounts, members, role assignments, messages, files, invitations, Gatherings and live calls are excluded. This is a configuration template, not a data backup.')}</p><button className="secondary-button" disabled={download.isPending} onClick={() => download.mutate()}>{t(download.isPending ? 'Preparing configuration…' : 'Download configuration')}</button>{download.isError && <p role="alert">{t(download.error.message)}</p>}</section>;
}

export function ConfigurationImport({ user }: { user: string }) {
  const { t } = useI18n(); const client = useQueryClient(); const navigate = useNavigate();
  const [open, setOpen] = useState(false); const [document, setDocument] = useState<CommunityConfiguration>(); const [name, setName] = useState(''); const [error, setError] = useState(''); const [reading, setReading] = useState(false);
  const selection = useRef(0); const request = useRef({ payload: '', id: crypto.randomUUID() });
  const restore = useMutation({ mutationFn: async () => {
    if (!document) throw new Error('Check a configuration file first.');
    const payload = JSON.stringify({ name: name.trim(), document });
    if (request.current.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    return restoreConfiguration(request.current.id, name.trim(), document);
  }, onSuccess: async result => { await client.invalidateQueries({ queryKey: communityListKey(user) }); navigate(`/communities/${result.communityId}`); } });
  const ruleSummary = (resourceName: string, rule: CommunityConfiguration['channelRules'][number], index: number) => <li key={`${resourceName}:${index}`}><strong>{resourceName} · {document?.roles.find(r => r.id === rule.roleId)?.name}</strong><p>{t('Allows: ')}{bits.filter(b => (Number(rule.allow) & b.bit) !== 0).map(b => t(b.key)).join(', ') || t('None')}</p><p>{t('Denies: ')}{bits.filter(b => (Number(rule.deny) & b.bit) !== 0).map(b => t(b.key)).join(', ') || t('None')}</p></li>;
  return <section className="about-panel administration-panel"><h2>{t('Create from configuration')}</h2><p>{t('Check a configuration file, then create a separate community. Existing communities stay unchanged. You will be its only member and owner.')}</p><button className="secondary-button" aria-expanded={open} disabled={restore.isPending || reading} onClick={() => { setOpen(!open); selection.current++; setDocument(undefined); setError(''); restore.reset(); }}>{t(open ? 'Close configuration import' : 'Choose configuration file')}</button>{open && <>
    <label>{t('Configuration file (JSON, up to 256 KiB)')}<input type="file" accept=".json,application/json" disabled={reading || restore.isPending} onChange={e => {
      const file = e.target.files?.[0]; const current = ++selection.current; setDocument(undefined); setError(''); restore.reset();
      if (!file) return; if (file.size > 256 * 1024) { setError('Use a JSON configuration file up to 256 KiB.'); return; }
      setReading(true);
      void file.text().then(text => { let raw: unknown; try { raw = JSON.parse(text); } catch { throw new Error('Invalid configuration JSON.'); } return previewConfiguration(raw); }).then(result => { if (current === selection.current) { setDocument(result); setName(`${result.name} copy`.slice(0, 80)); } }).catch((e: unknown) => { if (current === selection.current) setError(e instanceof Error ? e.message : 'Invalid configuration JSON.'); }).finally(() => { if (current === selection.current) setReading(false); });
    }} /></label>
    {reading && <p role="status">{t('Checking configuration…')}</p>}{error && <p role="alert">{t(error)}</p>}
    {document && <div className="configuration-review"><h3>{t('Review configuration before creating')}</h3><p>{t('Source name: {value}', { value: document.name })}</p><p>{t('{roles} roles · {categories} categories · {channels} channels', { roles: document.roles.length, categories: document.categories.length, channels: document.channels.length })}</p><details><summary>{t('Review names and rules')}</summary><ul>{document.roles.map(r => <li key={r.id}>{t('Role')}: {r.name} · {t('Role rank')}: {r.rank} · {bits.filter(b => (b.bit & Number(r.grants)) !== 0).map(b => t(b.key)).join(', ') || t('None')}</li>)}{document.categories.map(c => <li key={c.id}>{t('Category')}: {c.name}</li>)}{document.channels.map(c => <li key={c.id}>{c.kind === 'Forum' ? t('Forum') + ': ' : '#'}{c.name}{c.categoryId && ` / ${document.categories.find(cat => cat.id === c.categoryId)?.name}`}</li>)}</ul><p>{t('Voice category')}: {document.categories.find(c => c.id === document.voiceCategoryId)?.name ?? t('No category')}</p><h4>{t('Category rules')}</h4><ul>{document.categoryRules.map((r, i) => ruleSummary(document.categories.find(c => c.id === r.resourceId)!.name, r, i))}</ul><h4>{t('Channel rules')}</h4><ul>{document.channelRules.map((r, i) => ruleSummary(`#${document.channels.find(c => c.id === r.resourceId)!.name}`, r, i))}</ul><h4>{t('Voice rules')}</h4><ul>{document.voiceRules.map((r, i) => ruleSummary(t('Voice room'), r, i))}</ul></details>
      <label>{t('New community name')}<input value={name} minLength={2} maxLength={80} disabled={restore.isPending} onChange={e => setName(e.target.value)} /></label>
      <p className="field-hint">{t('No members or content will be imported. All resource IDs will be replaced. Review access rules before inviting anyone.')}</p>
      <ConfirmAction danger={false} label={t('Create separate community')} title={t('Create {value} from this configuration?', { value: name.trim() })} description={t('This creates a new community with these roles and rules. It does not restore messages or modify the source.')} confirmLabel={t('Create separate community')} disabled={restore.isPending || name.trim().length < 2} onConfirm={() => restore.mutate()} />
    </div>}
    {restore.isError && <p role="alert">{t(restore.error.message)}</p>}
  </>}</section>;
}
