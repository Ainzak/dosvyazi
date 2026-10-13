import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/LocaleContext';
import { communityKeys } from '../../api/communities';
import { reactions, react, search, getRead, markRead, listEmoji, emojiImage, createEmoji, removeEmoji } from '../../api/completeness';
import type { Message } from '../../api/messages';
import { ApiError } from '../../api/http';

const emojiKey = (user: string, community: string) => [...communityKeys(user, community), 'emoji'];
const readKey = (user: string, community: string, channel: string) => [...communityKeys(user, community), 'channel', channel, 'read'];
export function UnreadBadge({ user, community, channel }: { user: string; community: string; channel: string }) {
  const { t } = useI18n(); const result = useQuery({ queryKey: readKey(user, community, channel), queryFn: ({ signal }) => getRead(community, channel, signal), refetchInterval: 15000 });
  return result.data && Number(result.data.unread) > 0 ? <small aria-hidden="true" title={t('Unread messages')}>{result.data.unread}</small> : null;
}
export function MessageExtras({ user, community, channel, watermark }: { user: string; community: string; channel: string; watermark: string }) {
  const { t } = useI18n(); const client = useQueryClient(); const [query, setQuery] = useState(''); const [term, setTerm] = useState('');
  const read = useQuery({ queryKey: readKey(user, community, channel), queryFn: ({ signal }) => getRead(community, channel, signal), refetchInterval: 10000 });
  const mark = useMutation({ mutationFn: () => markRead(community, channel, watermark), onSuccess: data => client.setQueryData(readKey(user, community, channel), data) });
  const [before, setBefore] = useState<string>();
  const results = useQuery({ queryKey: [...communityKeys(user, community), 'channel', channel, 'search', term, before], queryFn: ({ signal }) => search(community, channel, term, before, signal), enabled: !!term, refetchInterval: 5000 });
  const visible = results.error instanceof ApiError && [401, 403, 404].includes(results.error.status) ? undefined : results.data;
  return <section className="message-extras"><div className="composer-footer"><span>{t('Unread messages')}: {read.data?.unread ?? '…'}</span><button className="secondary-button" disabled={mark.isPending} onClick={() => mark.mutate()}>{t('Mark as read')}</button></div>{read.isError && <p role="alert">{t(read.error.message)}</p>}{mark.isError && <p role="alert">{t(mark.error.message)}</p>}
    <form onSubmit={event => { event.preventDefault(); setBefore(undefined); setTerm(query.trim()); }}><label htmlFor="message-search">{t('Search this channel')}</label><input id="message-search" required maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /><button className="secondary-button">{t('Search')}</button></form>
    {term && <><button className="secondary-button" onClick={() => { setTerm(''); setBefore(undefined); }}>{t('Close search')}</button>{results.isPending && <p role="status">{t('Searching…')}</p>}{results.isError && <><p role="alert">{t(results.error.message)}</p><button onClick={() => void results.refetch()}>{t('Retry search')}</button></>}
      {visible?.messages.length === 0 && <p>{t('No matching messages.')}</p>}<ul className="search-results">{visible?.messages.map(m => <li key={m.id}><Link to={`/profiles/${m.authorId}`}>{m.authorName}</Link><p>{m.content}</p><small>{m.attachment?.name}</small></li>)}</ul>{visible?.hasMore && <button onClick={() => setBefore(visible.before ?? undefined)}>{t('Older results')}</button>}</>}
  </section>;
}
export function MessageContent({ content, community, user }: { content: string; community: string; user: string }) {
  const emoji = useQuery({ queryKey: emojiKey(user, community), queryFn: ({ signal }) => listEmoji(community, signal), staleTime: 10000 });
  return <p>{content.split(/(:[a-z0-9_]{2,32}:)/g).map((text, index) => { const item = emoji.data?.find(e => text === `:${e.name}:`); return item ? <img key={index} width="24" height="24" src={emojiImage(community, item.id)} alt={text} /> : text; })}</p>;
}
export function EmojiPicker({ community, user, pick, disabled }: { community: string; user: string; pick: (text: string) => void; disabled: boolean }) {
  const { t } = useI18n(); const emoji = useQuery({ queryKey: emojiKey(user, community), queryFn: ({ signal }) => listEmoji(community, signal), staleTime: 10000 });
  return <div className="message-reactions" aria-label={t('Insert emoji')}>{reactions.map(e => <button type="button" className="secondary-button" key={e} disabled={disabled} aria-label={`${t('Insert emoji')} ${e}`} onClick={() => pick(e)}>{e}</button>)}{emoji.data?.map(e => <button type="button" className="secondary-button" key={e.id} disabled={disabled} aria-label={`${t('Insert emoji')} ${e.name}`} onClick={() => pick(`:${e.name}:`)}><img width="24" height="24" alt={e.name} src={emojiImage(community, e.id)} /></button>)}</div>;
}
export function MessageReactions({ message, user, community, channel, canSend }: { message: Message; user: string; community: string; channel: string; canSend: boolean }) {
  const { t } = useI18n(); const client = useQueryClient();
  const emoji = useQuery({ queryKey: emojiKey(user, community), queryFn: ({ signal }) => listEmoji(community, signal), staleTime: 10000 });
  const command = useRef({ payload: '', id: crypto.randomUUID() });
  const mutation = useMutation({ mutationFn: ({ key, active }: { key: string; active: boolean }) => { const payload = JSON.stringify({ key, active }); if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() }; return react(community, channel, message.id, command.current.id, key, active); }, onSuccess: async () => { command.current.payload = ''; await client.invalidateQueries({ queryKey: [...communityKeys(user, community), 'channel', channel, 'messages'] }); } });
  const customKeys = (message.reactions ?? []).filter(r => r.emoji.startsWith('custom:')).map(r => r.emoji);
  const choices = [...reactions, ...new Set([...(emoji.data ?? []).map(e => `custom:${e.id}`), ...customKeys])];
  return <div className="message-reactions" aria-label={t('Reactions')}>{choices.map(key => { const state = message.reactions?.find(r => r.emoji === key); const item = emoji.data?.find(e => key === `custom:${e.id}`); const removed = key.startsWith('custom:') && !item;
    return <button key={key} className="secondary-button" aria-label={`${t('Reaction')} ${item ? item.name : removed ? t('Removed emoji') : key}`} aria-pressed={state?.mine ?? false} disabled={!canSend || mutation.isPending || (removed && !state?.mine)} onClick={() => mutation.mutate({ key, active: !state?.mine })}>{item ? <img width="24" height="24" src={emojiImage(community, item.id)} alt={item.name} /> : removed ? t('Removed emoji') : key} {state?.count ?? 0}</button>;
  })}{mutation.isError && <><p role="alert">{t(mutation.error.message)}</p><button className="secondary-button" disabled={!canSend} onClick={() => mutation.mutate(mutation.variables!)}>{t('Retry reaction')}</button></>}</div>;
}
export function EmojiManager({ community, user, canManage }: { community: string; user: string; canManage: boolean }) {
  const { t } = useI18n(); const client = useQueryClient(); const command = useRef({ payload: '', file: null as File | null, id: crypto.randomUUID() });
  const list = useQuery({ queryKey: emojiKey(user, community), queryFn: ({ signal }) => listEmoji(community, signal), refetchInterval: 15000 });
  const refresh = () => client.invalidateQueries({ queryKey: emojiKey(user, community) });
  const upload = useMutation({ mutationFn: (data: FormData) => { const file = data.get('file') as File; const name = String(data.get('name')); if (command.current.payload !== name || command.current.file?.name !== file.name || command.current.file?.lastModified !== file.lastModified) command.current = { payload: name, file, id: crypto.randomUUID() }; return createEmoji(community, command.current.id, name, file); }, onSuccess: async () => { command.current.payload = ''; await refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => removeEmoji(community, id), onSuccess: refresh });
  return <section className="about-panel"><h2>{t('Custom emoji')}</h2>{list.isPending && <p role="status">{t('Loading emoji…')}</p>}{list.isError && <p role="alert">{t(list.error.message)}</p>}{list.data?.length === 0 && <p>{t('No custom emoji yet.')}</p>}<ul className="management-list">{list.data?.map(e => <li key={e.id}><span><img width="24" height="24" src={emojiImage(community, e.id)} alt={e.name} /> :{e.name}:</span>{canManage && <button className="secondary-button" aria-label={`${t('Remove emoji')} ${e.name}`} disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>{t('Remove emoji')}</button>}</li>)}</ul>
    {canManage && <form className="emoji-upload" onSubmit={event => { event.preventDefault(); upload.mutate(new FormData(event.currentTarget)); }}><label htmlFor="emoji-name">{t('Emoji name')}</label><input id="emoji-name" name="name" required pattern="[a-z0-9_]{2,32}" maxLength={32} disabled={upload.isPending} /><label htmlFor="emoji-file">{t('Emoji PNG')}</label><input id="emoji-file" name="file" type="file" accept=".png" required disabled={upload.isPending} /><p className="field-hint">{t('PNG up to 256 KiB and 256 by 256 pixels. Names use lowercase letters, digits and underscores.')}</p><button className="primary-button" disabled={upload.isPending}>{t(upload.isPending ? 'Sending…' : 'Upload emoji')}</button></form>}
    {upload.isError && <p role="alert">{t(upload.error.message)}</p>}{remove.isError && <p role="alert">{t(remove.error.message)}</p>}
  </section>;
}
