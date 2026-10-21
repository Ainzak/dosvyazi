import { useEffect, useId, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { LanguageSwitcher } from '../i18n/LanguageProvider';
import { useI18n } from '../i18n/LocaleContext';

export function AccountOptions() {
  const { t } = useI18n(); const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div ref={root} className="workspace-account-options" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className="icon-button" aria-label={t('Account options')} title={t('Account options')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Settings size={18} aria-hidden="true" /></button>
    {open && <div className="account-options-menu" id={id}><p>{t('Interface language')}</p><LanguageSwitcher /></div>}
  </div>;
}
