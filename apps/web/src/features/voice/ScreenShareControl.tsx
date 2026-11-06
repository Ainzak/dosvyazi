import { useEffect, useId, useRef, useState } from 'react';
import { MonitorUp } from 'lucide-react';
import { useI18n } from '../../i18n/LocaleContext';
import type { VoiceClient, VoiceSnapshot } from './VoiceClient';

export function ScreenShareControl({ state, client, audio, changeAudio }: { state: VoiceSnapshot; client: VoiceClient; audio: boolean; changeAudio: (value: boolean) => void }) {
  const { t } = useI18n();
  const title = useId();
  const [open, setOpen] = useState(false);
  const [systemAudio, setSystemAudio] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const allowed = state.status === 'Connected' && state.canShareScreen && !state.changingMedia && !!navigator.mediaDevices?.getDisplayMedia;
  useEffect(() => {
    if (open && allowed && !state.sharing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open, allowed, state.sharing]);
  return <>
    <button ref={trigger} className={`icon-button${state.sharing ? ' is-active' : ''}`} aria-label={t(state.sharing ? 'Stop sharing' : 'Share screen')} title={t(state.sharing ? 'Stop sharing' : 'Share screen')} aria-pressed={state.sharing} aria-haspopup={state.sharing ? undefined : 'dialog'} disabled={!allowed} onClick={() => {
      if (state.sharing) void client.media('screen', false); else setOpen(true);
    }}><MonitorUp size={22} aria-hidden="true" /></button>
    {open && <dialog ref={dialog} className="management-dialog screen-share-dialog" aria-label={t('Share your screen')} aria-labelledby={title} onClose={() => { setOpen(false); trigger.current?.focus(); }} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) event.currentTarget.close();
    }}>
      <h2 id={title}>{t('Share your screen')}</h2>
      <label className="voice-screen-audio"><input type="checkbox" checked={audio} onChange={event => changeAudio(event.target.checked)} />{t('Include screen audio when available')}</label>
      <p>{t('In the browser picker, choose a tab, window or screen. To send sound, also enable its audio checkbox when offered.')}</p>
      <p className="field-hint">{t('Sharing a browser tab is usually the most reliable option for sound. Window and whole-screen audio depend on your browser and operating system.')}</p>
      {audio && <><label>{t('Sound source')}<select aria-label={t('Sound source')} value={systemAudio ? 'system' : 'window'} onChange={event => setSystemAudio(event.target.value === 'system')}><option value="window">{t('Selected tab or application only')}</option><option value="system">{t('Entire system audio')}</option></select></label>
        <p className="field-hint">{t(systemAudio ? 'System audio can send other participants their own voices back. Use headphones and prefer a selected tab or application.' : 'Requests audio from the selected application and excludes this call where supported. If your browser cannot isolate application audio, share a browser tab instead.')}</p></>}
      <div className="settings-actions"><button className="primary-button" disabled={!allowed} onClick={() => {
        dialog.current?.close();
        // Keep capture in this click's activation; never await before the browser picker.
        void client.media('screen', true, audio, systemAudio);
      }}>{t('Choose source')}</button><button className="secondary-button" onClick={() => dialog.current?.close()}>{t('Cancel')}</button></div>
    </dialog>}
  </>;
}
