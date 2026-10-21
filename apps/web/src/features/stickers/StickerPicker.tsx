import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import * as api from '../../api/stickers';
import { useI18n } from '../../i18n/LocaleContext';
import { AttachmentDownload } from '../messages/AttachmentDownload';
import { Sticker } from 'lucide-react';

export function StickerPicker({ user, disabled, selected, pick, compact = false }: { user: string; disabled: boolean; selected: api.Selection | null; pick: (value: api.Selection | null) => void; compact?: boolean }) {
  const { t } = useI18n(); const [open, setOpen] = useState(false); const [name, setName] = useState('');
  const packs = useQuery({ queryKey: [...api.stickerKeys(user), 'library'], queryFn: ({ signal }) => api.library(signal), enabled: open });
  const details = useQuery({ queryKey: [...api.stickerKeys(user), name], queryFn: ({ signal }) => api.pack(name, signal), enabled: open && !!name });
  return <div className="sticker-picker">
    <button type="button" className="secondary-button" aria-label={t('Stickers')} title={t('Stickers')} aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>{compact ? <Sticker size={18} aria-hidden="true" /> : t('Stickers')}</button>
    {!compact && <StickerSelection selected={selected} disabled={disabled} remove={() => pick(null)} />}
    {open && <div className="sticker-picker-content">
      <Link to="/stickers">{t('Manage sticker packs')}</Link>
      {packs.isPending && <p role="status">{t('Loading sticker packs…')}</p>}
      {packs.isError && <><p role="alert">{t(packs.error.message)}</p><button type="button" onClick={() => void packs.refetch()}>{t('Try again')}</button></>}
      {packs.data?.length === 0 && <p>{t('No packs yet. Create one or find a pack by its unique name.')}</p>}
      {!!packs.data?.length && <label>{t('Choose a sticker pack')}<select aria-label={t('Choose a sticker pack')} value={name} onChange={event => setName(event.target.value)}><option value="">{t('Choose a pack…')}</option>{packs.data.map(pack => <option key={pack.id} value={pack.name}>{pack.title} ({pack.name})</option>)}</select></label>}
      {details.isFetching && !!name && <p role="status">{t('Loading sticker pack…')}</p>}{details.isError && <p role="alert">{t(details.error.message)}</p>}
      {details.data && <><p className="field-hint">{t('Artwork loads only when you choose View. Selecting a sticker prepares it for sending.')}</p><ul className="sticker-list">{details.data.stickers.map(sticker => <li key={sticker.id}>
        <strong>{sticker.label}</strong><button type="button" className="secondary-button" disabled={disabled} onClick={() => { pick({ id: sticker.id, label: sticker.label, pack: name }); setOpen(false); }}>{t('Use sticker: {value}', { value: sticker.label })}</button>
        <AttachmentDownload attachment={{ ...sticker, kind: 'File' }} url={api.assetUrl(name, sticker.id)} />
      </li>)}</ul></>}
    </div>}
  </div>;
}

export function StickerSelection({ selected, disabled, remove }: { selected: api.Selection | null; disabled: boolean; remove: () => void }) {
  const { t } = useI18n();
  return selected && <p className="selected-attachment">{t('Sticker ready: {value}', { value: selected.label })} <button type="button" className="secondary-button" disabled={disabled} onClick={remove}>{t('Remove selected sticker')}</button></p>;
}
