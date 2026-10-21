import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Ellipsis, Paperclip, X } from 'lucide-react';
import { useI18n } from '../../i18n/LocaleContext';

export function MessageAvatar({ name, user }: { name: string; user: string }) {
  const { t } = useI18n();
  return <Link className="message-avatar" to={`/profiles/${user}`} aria-label={t('View profile of {value}', { value: name })}>
    {Array.from(name.trim()).slice(0, 2).join('').toLocaleUpperCase()}
  </Link>;
}

export function MessageActionMenu({ name, children }: { name: string; children: ReactNode }) {
  const { t } = useI18n(); const details = useRef<HTMLDetailsElement>(null); const summary = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !details.current?.contains(event.target) && details.current) details.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <details ref={details} className="message-action-menu" onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={event => {
    if (event.key === 'Escape' && details.current?.open) { event.stopPropagation(); details.current.open = false; summary.current?.focus(); }
  }}>
    <summary ref={summary} aria-label={t('Message actions by {value}', { value: name })} title={t('Message actions')}><Ellipsis size={20} aria-hidden="true" /></summary>
    <div className="message-action-options">{children}</div>
  </details>;
}

export function ComposerTools({ children, recording }: { children: ReactNode; recording: boolean }) {
  const { t } = useI18n(); const [open, setOpen] = useState(false); const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const expanded = open || recording;
  const close = () => { if (!recording) { setOpen(false); trigger.current?.focus(); } };
  useEffect(() => {
    if (!expanded || recording) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const submitted = () => setOpen(false);
    const form = root.current?.closest('form');
    document.addEventListener('pointerdown', outside); form?.addEventListener('submit', submitted);
    return () => { document.removeEventListener('pointerdown', outside); form?.removeEventListener('submit', submitted); };
  }, [expanded, recording]);
  return <div className="composer-tools" ref={root}>
    <button ref={trigger} type="button" className="secondary-button" aria-label={t('Attach / record')} title={t('Attach / record')} aria-expanded={expanded} disabled={recording} onClick={() => setOpen(!open)}><Paperclip size={18} aria-hidden="true" /></button>
    <div className="composer-attachments" role="region" aria-label={t('Attachments and recording')} hidden={!expanded} onKeyDown={event => { if (event.key === 'Escape' && !recording) { event.stopPropagation(); close(); } }}>
      <div className="composer-tools-heading"><h3>{t('Attachments and recording')}</h3><button type="button" className="icon-button" aria-label={t('Close attachments')} disabled={recording} onClick={close}><X size={20} aria-hidden="true" /></button></div>
      {children}
    </div>
  </div>;
}
