import { useI18n } from '../../i18n/LocaleContext';
export function HistoryWindowControls({ window, move }: { window: { earlier: boolean; newer: boolean; media: boolean; previous: () => void; next: () => void; latest: () => void }; move: (action: () => void, latest?: boolean) => void }) {
  const { t } = useI18n();
  if (!window.earlier && !window.newer && !window.media) return null;
  return <div className="history-window-controls" aria-label={t('Loaded history window')}>
    {(window.earlier || window.newer) && <p className="field-hint">{t('Up to 100 messages are displayed at once. Earlier loaded messages stay available; media closes when it leaves this window.')}</p>}
    {window.media && <p className="field-hint">{t('Up to 6 message media items stay open. Opening another closes the oldest.')}</p>}
    {window.earlier && <button className="secondary-button" onClick={() => move(window.previous)}>{t('Show earlier loaded messages')}</button>}
    {window.newer && <><button className="secondary-button" onClick={() => move(window.next)}>{t('Show newer loaded messages')}</button><button className="secondary-button" onClick={() => move(window.latest, true)}>{t('Jump to latest messages')}</button></>}
  </div>;
}
