import type { VoiceSnapshot } from './VoiceClient';
import type { QualitySource, ScreenQuality } from './mediaQuality';
import { useI18n } from '../../i18n/LocaleContext';

export function MediaQualitySettings({ state, change }: { state: VoiceSnapshot; change: (source: QualitySource, value: ScreenQuality) => void }) {
  const { t } = useI18n();
  const busy = state.status !== 'Connected' || !!state.changingQuality || state.changingMedia || state.changingAudio || state.changingNoiseSuppression;
  return <fieldset className="voice-quality-settings"><legend>{t('Media quality')}</legend>
    <p className="field-hint">{t('Saved on this device. Each setting changes only your outgoing source.')}</p>
    <label><input type="checkbox" checked={state.quality.audio === 'economy'} disabled={busy || !state.canSpeak} onChange={event => change('audio', event.target.checked ? 'economy' : 'standard')} />{t('Reduce audio quality')}</label>
    <p className="field-hint">{t('Uses a lower speech bitrate. Camera, screen and noise suppression stay independent.')}</p>
    <label><input type="checkbox" checked={state.quality.camera === 'economy'} disabled={busy || !state.canUseCamera} onChange={event => change('camera', event.target.checked ? 'economy' : 'standard')} />{t('Reduce camera quality')}</label>
    <p className="field-hint">{t('Smaller, less frequent camera frames use less data.')}</p>
    <label>{t('Screen-sharing quality')}<select aria-label={t('Screen-sharing quality')} value={state.quality.screen} disabled={busy || !state.canShareScreen} onChange={event => change('screen', event.target.value as ScreenQuality)}>
      <option value="economy">{t('Economy · up to 480p, 10 fps')}</option>
      <option value="standard">{t('Standard · up to 720p, 15 fps')}</option>
      <option value="high">{t('High · up to 1080p, 30 fps')}</option>
      <option value="ultra">{t('Ultra · up to 1440p, 60 fps')}</option>
    </select></label>
    <p className="field-hint">{t('High improves screen detail and motion but needs more bandwidth and processing. Actual quality depends on your source, browser and connection.')}</p>
    <p className="field-hint">{t('1440p / 60 fps uses a video bitrate ceiling of 12 Mbps. A lower-resolution or slower source will not gain detail or frames.')}</p>
    <p className="field-hint">{t('An active source may pause briefly while its quality changes. Other sources stay on.')}</p>
    {state.changingQuality && <p role="status">{t('Applying media quality…')}</p>}
    {state.qualityError && <p role="alert">{t(state.qualityError)}</p>}
  </fieldset>;
}
