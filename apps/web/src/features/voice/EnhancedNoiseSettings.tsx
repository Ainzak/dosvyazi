import { useI18n } from '../../i18n/LocaleContext';
import type { VoiceClient, VoiceSnapshot } from './VoiceClient';

export function EnhancedNoiseSettings({ state, client }: { state: VoiceSnapshot; client: VoiceClient }) {
  const { t } = useI18n();
  return <fieldset className="voice-quality-settings"><legend>{t('Enhanced microphone processing')}</legend>
    <label><input type="checkbox" checked={state.enhancedNoise} disabled={state.status !== 'Connected' || !state.canSpeak || state.changingAudio || !!state.changingQuality || state.changingNoiseSuppression || state.pttHeld || (!state.enhancedNoiseSupported && !state.enhancedNoise)} onChange={event => void client.enhancedNoise(event.target.checked)} />{t('Enhanced noise suppression (RNNoise)')}</label>
    <p className="field-hint">{t('Runs on this device, without sending audio to a processing service. Processing cost and voice quality depend on your device, microphone and noise.')}</p>
    <p className="field-hint">{t('Changing this mode mutes your microphone. Enable it again, or hold Push to Talk. Browser suppression is replaced, while echo cancellation stays on.')}</p>
    <p className="field-hint" role="status">{t(!state.enhancedNoiseSupported ? 'Enhanced processing is unavailable in this browser.' : state.enhancedStarting ? 'Starting enhanced microphone…' : !state.enhancedNoise ? 'Browser microphone processing is selected.' : state.enhancedNoiseApplied && !state.muted ? 'Enhanced noise processing is active.' : 'Enhanced processing applies when you transmit.')}</p>
    {state.enhancedNoise && <p className="field-hint">{t('Mute before changing the microphone device. Capture may remain active while muted; enhanced processing pauses until you transmit again. Leave voice to release capture.')}</p>}
    {state.enhancedNoiseError && <p role="alert">{t(state.enhancedNoiseError)}</p>}
    <a className="about-link" href="/third-party/rnnoise.txt" target="_blank" rel="noreferrer">{t('Noise processing licenses')}</a>
  </fieldset>;
}
