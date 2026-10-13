import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { gatheringKeys, gatheringNotices } from '../../api/gatherings';
import { useI18n } from '../../i18n/LocaleContext';
import { useGatheringLive } from './useGatheringLive';
export function GatheringsLink({ user, community }: { user: string; community: string }) {
  const { t } = useI18n(); useGatheringLive(user, community);
  const notices = useQuery({ queryKey: [...gatheringKeys(user, community), 'notices', 0], queryFn: ({ signal }) => gatheringNotices(community, 0, signal), refetchInterval: 15000 });
  const count = notices.data?.items.filter(n => !n.seen).length ?? 0;
  return <p><Link to={`/communities/${community}/gatherings`}>{t('Gatherings')}{count > 0 && <span aria-hidden="true" className="gathering-badge"> {count}</span>}</Link></p>;
}
