import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useI18n } from '../../i18n/LocaleContext';
import type { VoiceClient, VoiceSnapshot } from './VoiceClient';
import { shortcutFromEvent, shortcutLabel } from './voiceShortcuts';
import type { VoiceShortcuts } from './voiceShortcuts';

function ShortcutField({ action, state, client }: { action: keyof VoiceShortcuts; state: VoiceSnapshot; client: VoiceClient }) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = action === 'talk' ? 'Push-to-talk shortcut' : 'Mute/unmute shortcut';
  const capture = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return;
    if (event.key === 'Tab') { setRecording(false); return; }
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { setRecording(false); setError(null); return; }
    if (event.repeat || event.nativeEvent.isComposing || /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(event.code)) return;
    const binding = shortcutFromEvent(event.nativeEvent);
    const problem = binding ? client.shortcut(action, binding) : 'This shortcut is reserved or unsupported. Choose another combination.';
    setError(problem); if (!problem) setRecording(false);
  };
  return <div className="voice-shortcut-field"><label>{t(label)}<input readOnly aria-label={t(label)} value={recording ? t('Press a key combination…') : t(shortcutLabel(state.shortcuts[action]))}
    data-voice-shortcut-recording={recording ? '' : undefined} onFocus={() => { void client.holdToTalk(false); setRecording(true); setError(null); }} onClick={() => { void client.holdToTalk(false); setRecording(true); setError(null); }}
    onBlur={() => { setRecording(false); setError(null); }} onKeyDown={capture} onKeyUp={event => {
      if (!recording || event.code !== 'ControlRight' || event.altKey || event.shiftKey || event.metaKey) return;
      const problem = client.shortcut(action, { code: 'ControlRight', ctrl: true, alt: false, shift: false });
      setError(problem); if (!problem) setRecording(false);
    }} /></label>
    <button type="button" className="secondary-button" aria-label={t(action === 'talk' ? 'Clear push-to-talk shortcut' : 'Clear mute shortcut')} disabled={!state.shortcuts[action]} onClick={() => { setError(client.shortcut(action, null)); setRecording(false); }}>{t('Clear shortcut')}</button>
    {error && <p role="alert">{t(error)}</p>}
  </div>;
}

export function VoiceShortcutSettings({ state, client }: { state: VoiceSnapshot; client: VoiceClient }) {
  const { t } = useI18n();
  return <fieldset className="voice-quality-settings"><legend>{t('Microphone shortcuts')}</legend>
    <p className="field-hint">{t('Select a shortcut field, then press a physical key with optional Ctrl, Alt or Shift. Escape cancels. Saved on this device.')}</p>
    <ShortcutField action="talk" state={state} client={client} /><ShortcutField action="mute" state={state} client={client} />
    <button type="button" className="secondary-button" onClick={() => client.resetShortcuts()}>{t('Reset microphone shortcuts')}</button>
    <p className="field-hint">{t('Shortcuts work only in the active app tab, outside text fields. Browser and system shortcuts may be unavailable. Key positions stay the same in English and Russian layouts.')}</p>
    <p className="field-hint">{t('Mute/unmute works in continuous microphone mode. In Push to Talk, hold the talk shortcut or the on-screen button instead.')}</p>
  </fieldset>;
}
