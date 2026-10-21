import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Smile } from 'lucide-react';
import { communityKeys } from '../../api/communities';
import { emojiImage, listEmoji, reactions } from '../../api/completeness';
import { useI18n } from '../../i18n/LocaleContext';

export function EmojiMenu({ community, user, label, disabled, reaction, compact, pick }: {
  community: string; user: string; label: string; disabled: boolean; reaction?: boolean; compact?: boolean; pick: (key: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const emoji = useQuery({ queryKey: [...communityKeys(user, community), 'emoji'], queryFn: ({ signal }) => listEmoji(community, signal), staleTime: 10000, enabled: open && !disabled });
  const query = filter.trim().toLowerCase();
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && root.current?.contains(document.activeElement)) { setOpen(false); trigger.current?.focus(); } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  function choose(key: string) { pick(key); setOpen(false); setFilter(''); trigger.current?.focus(); }
  const standard = reactions.filter(key => !query || key.includes(query));
  const custom = (emoji.data ?? []).filter(item => item.name.includes(query));
  return <div className="emoji-picker" ref={root}>
    <button type="button" className={`secondary-button emoji-trigger${reaction ? ' reaction-trigger' : ''}`} ref={trigger} disabled={disabled} aria-label={t(label)} title={t(label)} aria-expanded={open && !disabled} aria-controls={id} onClick={() => setOpen(!open)}><Smile size={18} aria-hidden="true" />{!reaction && !compact && <>{t(label)}<ChevronDown size={14} aria-hidden="true" /></>}</button>
    {open && !disabled && <div className="emoji-menu" id={id} role="group" aria-label={t(label)}>
      <label htmlFor={`${id}-search`}>{t('Find emoji')}</label><input id={`${id}-search`} type="search" maxLength={32} value={filter} onChange={event => setFilter(event.target.value)} />
      <div className="emoji-grid">{standard.map(key => <button type="button" className="secondary-button" key={key} aria-label={`${t(reaction ? 'Choose reaction' : 'Insert emoji')} ${key}`} onClick={() => choose(key)}>{key}</button>)}
        {custom.map(item => <button type="button" className="secondary-button" key={item.id} title={item.name} aria-label={`${t(reaction ? 'Choose reaction' : 'Insert emoji')} ${item.name}`} onClick={() => choose(reaction ? `custom:${item.id}` : `:${item.name}:`)}><img width="24" height="24" src={emojiImage(community, item.id)} alt="" /></button>)}</div>
      {emoji.isPending && <p role="status">{t('Loading emoji…')}</p>}
      {emoji.isError && <><p role="alert">{t(emoji.error.message)}</p><button type="button" className="secondary-button" onClick={() => void emoji.refetch()}>{t('Retry emoji')}</button></>}
      {!emoji.isPending && !emoji.isError && standard.length + custom.length === 0 && <p>{t('No matching emoji.')}</p>}
    </div>}
  </div>;
}
