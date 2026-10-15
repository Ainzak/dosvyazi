import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import * as api from '../../api/stickers';
import { useI18n } from '../../i18n/LocaleContext';
import { useSession } from '../accounts/useSession';

export function StickerPackInfo({ name }: { name: string }) {
  const session = useSession(); const { t } = useI18n(); const cache = useQueryClient();
  const user = session.data?.id ?? '';
  const data = useQuery({ queryKey: [...api.stickerKeys(user), name], queryFn: ({ signal }) => api.pack(name, signal), enabled: !!user });
  const save = useMutation({ mutationFn: (saved: boolean) => api.save(name, saved), onSuccess: () => cache.invalidateQueries({ queryKey: api.stickerKeys(user) }) });
  return <section className="sticker-pack-info" aria-label={t('Sticker pack information')}>
    {data.isPending && <p role="status">{t('Loading sticker pack…')}</p>}{data.isError && <p role="alert">{t(data.error.message)}</p>}
    {data.data && <><strong>{data.data.pack.title}</strong><p>{name} · {data.data.pack.count} {t('stickers')}</p>
      <Link to={`/stickers/${name}`}>{t('Open sticker pack')}</Link>
      {!data.data.pack.mine && <button type="button" className="secondary-button" disabled={save.isPending} onClick={() => save.mutate(!data.data!.pack.saved)}>{t(data.data.pack.saved ? 'Remove pack from library' : 'Save sticker pack')}</button>}
      {save.isSuccess && <p role="status">{t(save.variables ? 'Pack saved to your library.' : 'Pack removed from your library.')}</p>}
      {save.isError && <p role="alert">{t(save.error.message)}</p>}
    </>}
  </section>;
}
