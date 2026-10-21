import { useI18n } from '../../i18n/LocaleContext';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { communityKeys, getAudit } from '../../api/communities';

export function AuditPanel({ community, user }: { community: string; user: string }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const audit = useQuery({ queryKey: [...communityKeys(user, community), 'audit'], queryFn: ({ signal }) => getAudit(community, signal), enabled: open });
  return <section id="community-audit" className="about-panel audit-panel"><div className="settings-section-heading"><h2>{t("Moderation audit")}</h2><button className="secondary-button" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? t("Close audit") : t("View audit")}</button></div>{open && <>
    <p className="field-hint">{t("Latest 100 actions. Message content and invitation codes are omitted.")}</p>
    {audit.isPending && <p role="status">{t("Loading audit…")}</p>}
    {audit.isError && <p role="alert">{t(audit.error.message)}<button className="secondary-button" onClick={() => void audit.refetch()}>{t("Retry audit")}</button></p>}
    {audit.data?.length === 0 && <p>{t("No moderation actions yet.")}</p>}
    {!audit.isError && <ol className="management-list" aria-label={t("Moderation actions")}>{audit.data?.map(a => <li key={a.id}><div><strong>{a.actorName} · {a.action}</strong><span>{t("Target ")}{a.targetId}</span><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString(locale)}</time></div></li>)}</ol>}
  </>}</section>;
}
