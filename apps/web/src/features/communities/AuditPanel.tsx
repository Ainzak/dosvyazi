import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { communityKeys, getAudit } from '../../api/communities';

export function AuditPanel({ community, user }: { community: string; user: string }) {
  const [open, setOpen] = useState(false);
  const audit = useQuery({ queryKey: [...communityKeys(user, community), 'audit'], queryFn: ({ signal }) => getAudit(community, signal), enabled: open });
  return <section className="about-panel"><h2>Moderation audit</h2><button className="secondary-button" onClick={() => setOpen(v => !v)}>{open ? 'Close audit' : 'View audit'}</button>{open && <>
    <p className="field-hint">Latest 100 actions. Message content and invitation codes are omitted.</p>
    {audit.isPending && <p role="status">Loading audit…</p>}
    {audit.isError && <p role="alert">{audit.error.message}<button className="secondary-button" onClick={() => void audit.refetch()}>Retry audit</button></p>}
    {audit.data?.length === 0 && <p>No moderation actions yet.</p>}
    {!audit.isError && <ol className="management-list" aria-label="Moderation actions">{audit.data?.map(a => <li key={a.id}><div><strong>{a.actorName} · {a.action}</strong><span>Target {a.targetId}</span><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString('en')}</time></div></li>)}</ol>}
  </>}</section>;
}
