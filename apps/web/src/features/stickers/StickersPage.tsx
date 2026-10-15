import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import * as api from '../../api/stickers';
import { useI18n } from '../../i18n/LocaleContext';
import { useSession } from '../accounts/useSession';
import { AttachmentDownload } from '../messages/AttachmentDownload';

export function StickersPage() {
  const session = useSession(); const { t } = useI18n(); const { name } = useParams();
  if (session.isPending) return <p role="status">{t('Checking your session…')}</p>;
  if (session.isError) return <p role="alert">{t(session.error.message)}</p>;
  if (!session.data) return <><h1>{t('Sign in to use stickers.')}</h1><Link to="/login">{t('Sign in')}</Link></>;
  return <StickerWorkspace key={session.data.id} user={session.data.id} name={name} />;
}

function StickerWorkspace({ user, name }: { user: string; name?: string | undefined }) {
  const { t } = useI18n(); const navigate = useNavigate(); const cache = useQueryClient();
  const [find, setFind] = useState(''); const [unique, setUnique] = useState(''); const [title, setTitle] = useState('');
  const command = useRef({ payload: '', id: crypto.randomUUID() });
  const library = useQuery({ queryKey: [...api.stickerKeys(user), 'library'], queryFn: ({ signal }) => api.library(signal) });
  const create = useMutation({ mutationFn: () => { const payload = JSON.stringify({ unique, title }); if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() }; return api.create(command.current.id, unique, title); }, onSuccess: pack => { setUnique(''); setTitle(''); void cache.invalidateQueries({ queryKey: api.stickerKeys(user) }); navigate(`/stickers/${pack.name}`); } });
  return <><h1>{t('Sticker packs')}</h1><p>{t('Packs are visible to signed-in users by unique name or from a sent sticker. Save a pack to use it in chats and direct messages.')}</p>
    <form className="sticker-form" onSubmit={event => { event.preventDefault(); navigate(`/stickers/${encodeURIComponent(find.trim().toLowerCase())}`); }}><label htmlFor="find-pack">{t('Find pack by unique name')}</label><input id="find-pack" value={find} onChange={event => setFind(event.target.value)} required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,31}" /><button className="secondary-button">{t('Find pack')}</button></form>
    <details><summary>{t('Create a sticker pack')}</summary><form className="sticker-form" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
      <label htmlFor="pack-name">{t('Unique pack name')}</label><input id="pack-name" value={unique} onChange={event => setUnique(event.target.value)} required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9_\-]{2,31}" disabled={create.isPending} />
      <p className="field-hint">{t('3–32 lowercase letters, numbers, underscores or hyphens. The name is permanent and cannot be reused after retirement.')}</p>
      <label htmlFor="pack-title">{t('Pack title')}</label><input id="pack-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={64} disabled={create.isPending} />
      <button className="primary-button" disabled={create.isPending}>{t('Create pack')}</button>{create.isError && <p role="alert">{t(create.error.message)}</p>}
    </form></details>
    <h2>{t('Your sticker library')}</h2>{library.isPending && <p role="status">{t('Loading sticker packs…')}</p>}{library.isError && <><p role="alert">{t(library.error.message)}</p><button onClick={() => void library.refetch()}>{t('Try again')}</button></>}
    {library.data?.length === 0 && <p>{t('No packs yet. Create one or find a pack by its unique name.')}</p>}
    <ul className="sticker-library">{library.data?.map(pack => <li key={pack.id}><Link to={`/stickers/${pack.name}`}>{pack.title} ({pack.name})</Link> · {pack.count} {t('stickers')}{pack.builtIn ? ` · ${t('Built-in pack')}` : pack.mine ? ` · ${t('Your pack')}` : ''}</li>)}</ul>
    {name && <PackDetail key={`${user}:${name}`} user={user} name={name} />}
  </>;
}

function PackDetail({ user, name }: { user: string; name: string }) {
  const { t } = useI18n(); const cache = useQueryClient(); const navigate = useNavigate();
  const [label, setLabel] = useState(''); const [file, setFile] = useState<File | null>(null); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  const input = useRef<HTMLInputElement>(null); const command = useRef({ label: '', file: null as File | null, id: crypto.randomUUID() });
  const data = useQuery({ queryKey: [...api.stickerKeys(user), name], queryFn: ({ signal }) => api.pack(name, signal) });
  const refresh = () => cache.invalidateQueries({ queryKey: api.stickerKeys(user) });
  const upload = useMutation({ mutationFn: () => { if (command.current.label !== label || command.current.file !== file) command.current = { label, file, id: crypto.randomUUID() }; return api.upload(name, command.current.id, label, file!); }, onSuccess: () => { setFile(null); setLabel(''); if (input.current) input.current.value = ''; return refresh(); } });
  const save = useMutation({ mutationFn: (saved: boolean) => api.save(name, saved), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.remove(name, id), onSuccess: refresh });
  const retire = useMutation({ mutationFn: () => api.retire(name), onSuccess: () => { void refresh(); navigate('/stickers'); } });
  return <section className="about-panel sticker-pack-detail" aria-label={t('Sticker pack details')}>
    {data.isPending && <p role="status">{t('Loading sticker pack…')}</p>}{data.isError && <><p role="alert">{t(data.error.message)}</p><button onClick={() => void data.refetch()}>{t('Try again')}</button></>}
    {data.data && <><h2>{data.data.pack.title}</h2><p>{name} · {data.data.pack.count} {t('stickers')}</p><p className="field-hint">{t('Share this unique name or the page link. Saving adds the pack to your library without downloading its artwork.')}</p>
      <input aria-label={t('Sticker pack link')} readOnly value={`${location.origin}/stickers/${name}`} onFocus={event => event.target.select()} />
      {!data.data.pack.mine && <button className="primary-button" disabled={save.isPending} onClick={() => save.mutate(!data.data!.pack.saved)}>{t(data.data.pack.saved ? 'Remove pack from library' : 'Save sticker pack')}</button>}
      {save.isSuccess && <p role="status">{t(save.variables ? 'Pack saved to your library.' : 'Pack removed from your library.')}</p>}
      {data.data.pack.mine && <><form className="sticker-form" onSubmit={event => { event.preventDefault(); upload.mutate(); }}>
        <label htmlFor="sticker-label">{t('Sticker label')}</label><input id="sticker-label" value={label} onChange={event => setLabel(event.target.value)} required maxLength={64} disabled={upload.isPending} />
        <label htmlFor="sticker-artwork">{t('Sticker artwork')}</label><input id="sticker-artwork" type="file" ref={input} accept=".png,.gif" required disabled={upload.isPending} onChange={event => { const next = event.target.files?.[0] ?? null; const valid = !next || (next.size > 0 && next.size <= 1024 * 1024 && /\.(png|gif)$/i.test(next.name)); setFile(valid ? next : null); setError(valid ? '' : 'Choose a PNG or GIF sticker up to 1 MiB.'); }} />
        <p className="field-hint">{t('PNG or animated GIF, up to 1 MiB and 512 by 512 pixels. Up to 64 stickers per pack.')}</p><button className="primary-button" disabled={upload.isPending || !file || !!error}>{t(upload.isPending ? 'Uploading…' : 'Add sticker')}</button>
      </form><button className="secondary-button" onClick={() => setConfirm(!confirm)}>{t('Retire pack')}</button>{confirm && <><p>{t('Retiring removes the pack for everyone. Sent stickers remain in their messages. The unique name stays reserved.')}</p><button className="secondary-button" disabled={retire.isPending} onClick={() => retire.mutate()}>{t('Confirm retire pack')}</button></>}</>}
      {data.data.stickers.length === 0 && <p>{t('This pack has no stickers yet.')}</p>}
      <ul className="sticker-list">{data.data.stickers.map(sticker => <li key={sticker.id}><strong>{sticker.label}</strong><AttachmentDownload attachment={{ ...sticker, kind: 'File' }} url={api.assetUrl(name, sticker.id)} />{data.data!.pack.mine && <button className="secondary-button" disabled={remove.isPending} onClick={() => remove.mutate(sticker.id)}>{t('Remove sticker: {value}', { value: sticker.label })}</button>}</li>)}</ul>
    </>}
    {error && <p role="alert">{t(error)}</p>}{[save.error, upload.error, remove.error, retire.error].map((value, index) => value && <p key={index} role="alert">{t(value.message)}</p>)}
  </section>;
}
