import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/LocaleContext';
import { ConfirmAction } from '../../layout/ConfirmAction';

interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installPrompt: InstallPrompt | undefined;
// Capture early: the browser can dispatch before the About page is opened.
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event as InstallPrompt; window.dispatchEvent(new Event('dosvyazi-install-ready')); });
window.addEventListener('appinstalled', () => { installPrompt = undefined; });

export function InstallPanel() {
  const { t } = useI18n(); const [prompt, setPrompt] = useState(installPrompt); const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [waiting, setWaiting] = useState<ServiceWorker>();
  useEffect(() => {
    const ready = () => setPrompt(installPrompt); const done = () => { setInstalled(true); setPrompt(undefined); };
    window.addEventListener('dosvyazi-install-ready', ready); window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('dosvyazi-install-ready', ready); window.removeEventListener('appinstalled', done); };
  }, []);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let alive = true; let registration: ServiceWorkerRegistration | undefined; let installing: ServiceWorker | null = null;
    const changed = () => { if (alive && registration?.waiting) setWaiting(registration.waiting); };
    const found = () => { installing?.removeEventListener('statechange', changed); installing = registration?.installing ?? null; installing?.addEventListener('statechange', changed); changed(); };
    void navigator.serviceWorker.ready.then(r => { if (!alive) return; registration = r; registration.addEventListener('updatefound', found); found(); }).catch(() => { /* Installation help remains available without worker support. */ });
    return () => { alive = false; registration?.removeEventListener('updatefound', found); installing?.removeEventListener('statechange', changed); };
  }, []);
  return <section className="about-panel administration-panel"><h2>{t('Install Dosvyazi')}</h2><p>{t('Open Dosvyazi in its own window from your desktop or home screen. Installation uses this site and the same account session.')}</p>
    {installed ? <p role="status">{t('Running as an installed app.')}</p> : prompt ? <button className="primary-button" disabled={busy} onClick={() => {
      setBusy(true); setError(''); void prompt.prompt().then(() => prompt.userChoice).then(() => { installPrompt = undefined; setPrompt(undefined); }).catch(() => setError('Installation was not completed. Use your browser menu to install.')).finally(() => setBusy(false));
    }}>{t('Install app')}</button> : <p>{t('In Edge or Chrome, open the browser menu and choose Install app or Add to home screen when available. If installation is unavailable, keep using the browser.')}</p>}
    {error && <p role="alert">{t(error)}</p>}<p className="field-hint">{t('An internet connection is required. Offline messages, push notifications and reliable calls while the app is closed or the phone is locked are not available. Keep the app open for voice; screen sharing depends on the browser and device.')}</p>
    {waiting && <div><p role="status">{t('An app update is ready. Your current window stays open until you choose to reload.')}</p><ConfirmAction label={t('Reload for update')} title={t('Reload the app now?')} description={t('Reloading ends this window’s voice connection and discards unsent drafts. Finish your call and save your work first.')} confirmLabel={t('Reload now')} onConfirm={() => {
      const worker = waiting;
      const reload = () => { navigator.serviceWorker.removeEventListener('controllerchange', reload); window.location.reload(); };
      navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
      // Another window may already have activated this waiting worker. No new controllerchange would follow.
      if (worker.state === 'activated' || worker.state === 'redundant' || navigator.serviceWorker.controller === worker) reload();
      else worker.postMessage('ACTIVATE_REVIEWED_UPDATE');
    }} /></div>}
  </section>;
}
