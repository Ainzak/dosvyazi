import { useI18n } from '../../i18n/LocaleContext';
import type { VoiceClient, VoiceSnapshot } from './VoiceClient';

export function ReceivingSettings({ state, client }: { state: VoiceSnapshot; client: VoiceClient }) {
  const { t } = useI18n();
  const stats = state.connection;
  const number = (value: number | null, divisor = 1) => value === null ? '—' : (value / divisor).toFixed(1);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(client.connectionReport(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'dosvyazi-connection.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <fieldset className="voice-quality-settings"><legend>{t('Receiving and connection')}</legend>
    <label>{t('Incoming video')}<select aria-label={t('Incoming video')} value={state.receiving} disabled={state.status !== 'Connected'} onChange={event => client.receiving(event.target.value as VoiceSnapshot['receiving'])}>
      <option value="all">{t('Cameras and shared screens')}</option><option value="screen">{t('Shared screens only')}</option><option value="none">{t('Do not receive video')}</option>
    </select></label>
    <p className="field-hint">{t('Saved on this device. Voice and shared audio continue. Choose individual videos in the viewer. This does not change anyone’s broadcast.')}</p>
    {state.receivingError && <p role="alert">{t(state.receivingError)} <button className="secondary-button" onClick={() => client.receiving(state.receiving)}>{t('Retry receiving')}</button></p>}
    <details className="voice-connection"><summary>{t('Connection and media traffic')}</summary>
      <p role="status">{t(stats.status === 'ready' ? 'Media counters updating' : stats.status === 'unavailable' ? 'Media counters unavailable' : 'Waiting for media counters')}</p>
      <dl>
        <dt>{t('Sending (kbit/s)')}</dt><dd><output aria-label={t('Sending (kbit/s)')}>{number(stats.sendBps, 1000)}</output></dd>
        <dt>{t('Receiving (kbit/s)')}</dt><dd><output aria-label={t('Receiving (kbit/s)')}>{number(stats.receiveBps, 1000)}</output></dd>
        <dt>{t('Sent (MiB)')}</dt><dd>{number(stats.sentBytes, 1048576)}</dd><dt>{t('Received (MiB)')}</dt><dd>{number(stats.receivedBytes, 1048576)}</dd>
        <dt>{t('Round-trip delay (ms)')}</dt><dd>{number(stats.rttMs)}</dd><dt>{t('Receive jitter (ms)')}</dt><dd>{number(stats.jitterMs)}</dd>
        <dt>{t('Receive packet loss (%)')}</dt><dd>{number(stats.lossPercent)}</dd>
      </dl>
      {stats.videos.length > 0 && <ul className="voice-video-stats">{stats.videos.map((video, index) => <li key={index}>
        <strong>{t(video.direction === 'sending' ? 'Outgoing video' : 'Incoming video stream')} {index + 1}</strong>: {video.width ?? '—'} × {video.height ?? '—'} · {number(video.fps)} {t('fps')}
        <p>{t(video.interval === 'stale' ? 'Video counters are stale.' : video.interval === 'reset' ? 'Video counters restarted; waiting for an interval.' : video.interval === 'baseline' ? 'Waiting for a video measurement interval.' : 'Video measurement interval: {value}s', { value: number(video.intervalSeconds) })}</p>
        <dl>
          {video.direction === 'sending' ? <><dt>{t('Capture (fps)')}</dt><dd>{number(video.captureFps)}</dd><dt>{t('Encoding (ms/frame)')}</dt><dd>{number(video.processingMsPerFrame)}</dd><dt>{t('Browser quality limit')}</dt><dd>{video.limitation === null ? '—' : t(video.limitation === 'cpu' ? 'Encoder CPU load' : video.limitation === 'bandwidth' ? 'Network bandwidth' : video.limitation === 'none' ? 'No reported limit' : 'Other reported limit')}</dd></> : <>
            <dt>{t('Decoding (ms/frame)')}</dt><dd>{number(video.processingMsPerFrame)}</dd><dt>{t('Dropped frames (interval)')}</dt><dd>{number(video.droppedFrames)}</dd><dt>{t('Completed freezes (interval)')}</dt><dd>{number(video.freezes)}</dd><dt>{t('Freeze duration (ms, interval)')}</dt><dd>{number(video.freezeMs)}</dd>
          </>}
        </dl>
      </li>)}</ul>}
      <p className="field-hint">{t('Compare capture, encoding and received FPS to investigate stutters. CPU is the browser’s encoder limitation signal, not total device CPU. Drops and completed freezes refer only to the shown interval; missing or stale counters are not zero. These indicators do not establish a cause by themselves.')}</p>
      <p className="field-hint">{t('This voice connection only: RTP payload, not total internet usage. Rates use sample deltas; counters reset on a new voice connection. Missing values are unavailable. No CPU or memory estimate is made.')}</p>
      <button className="secondary-button" onClick={download}>{t('Save connection report')}</button>
      <p className="field-hint">{t('The report contains settings and aggregate counters, without names, messages, addresses or access tokens. Nothing is uploaded.')}</p>
    </details>
  </fieldset>;
}
