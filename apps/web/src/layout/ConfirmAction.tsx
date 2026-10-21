import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/LocaleContext';

export function ConfirmAction({ label, title, description, confirmLabel, disabled, onConfirm, children, danger = true }: {
  label: string; title: string; description: string; confirmLabel?: string; disabled?: boolean;
  onConfirm: () => void; children?: ReactNode; danger?: boolean;
}) {
  const { t } = useI18n(); const id = useId();
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const [intent, setIntent] = useState<{ title: string; description: string; confirmLabel: string; apply: () => void } | null>(null);
  useEffect(() => { if (intent) dialog.current?.showModal(); }, [intent]);
  return <div className="confirm-action"><button ref={trigger} type="button" className={`secondary-button${danger ? ' danger-button' : ''}`} disabled={disabled} aria-label={label} aria-haspopup="dialog"
    onClick={() => { setIntent({ title, description, confirmLabel: confirmLabel ?? t('Confirm action'), apply: onConfirm }); }}>{children ?? label}</button>
    <dialog ref={dialog} className="management-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onClose={() => { setIntent(null); trigger.current?.focus(); }}>
      {intent && <><h2 id={`${id}-title`}>{intent.title}</h2><p id={`${id}-description`}>{intent.description}</p><div className="settings-actions">
        <button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>{t('Cancel')}</button>
        <button type="button" className={`secondary-button${danger ? ' danger-button' : ''}`} onClick={() => { const apply = intent.apply; dialog.current?.close(); apply(); }}>{intent.confirmLabel}</button>
      </div></>}
    </dialog>
  </div>;
}
