import { Clock3 } from 'lucide-react';
import type { Gathering } from '../../api/gatherings';
import { useI18n } from '../../i18n/LocaleContext';
import { gatheringStateLabel } from './labels';

export function GatheringStatus({ state }: { state: string }) {
  const { t } = useI18n();
  return <span className={`gathering-status state-${state.toLowerCase()}`}>{t(gatheringStateLabel(state))}</span>;
}

export function GatheringCounts({ gathering }: { gathering: Gathering }) {
  const { t } = useI18n();
  return <div className="gathering-counts" aria-label={t('Participant responses')}>
    {['Pending', 'Accepted', 'Declined', 'NeedsClarification'].map(state => <span className={`state-${state.toLowerCase()}`} key={state}>
      {t(gatheringStateLabel(state))}: {gathering.invites.filter(invite => invite.state === state).length}
    </span>)}
  </div>;
}

export function GatheringTime({ gathering }: { gathering: Gathering }) {
  const { t, locale } = useI18n();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <div className="gathering-time">
    <div className="gathering-local-time"><Clock3 size={20} aria-hidden="true" /><div><strong>{t('Your local time')}</strong>
      <time dateTime={gathering.startAt}>{new Date(gathering.startAt).toLocaleString(locale, { timeZone: zone, timeZoneName: 'short' })} · {zone}</time>
    </div></div>
    <p>{t('Organizer time')}: {gathering.localStart.replace('T', ' ')} · {gathering.timeZoneId}</p>
  </div>;
}
