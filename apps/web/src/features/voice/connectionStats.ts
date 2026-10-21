export type ConnectionStats = {
  status: 'waiting' | 'ready' | 'unavailable'; sampledAt: number | null; elapsedSeconds: number;
  sentBytes: number; receivedBytes: number; sendBps: number | null; receiveBps: number | null;
  rttMs: number | null; jitterMs: number | null; lossPercent: number | null;
  incomingVideo: number; outgoingVideo: number;
  videos: { direction: 'sending' | 'receiving'; width: number | null; height: number | null; fps: number | null }[];
};
export const emptyConnectionStats = (): ConnectionStats => ({ status: 'waiting', sampledAt: null, elapsedSeconds: 0,
  sentBytes: 0, receivedBytes: 0, sendBps: null, receiveBps: null, rttMs: null, jitterMs: null, lossPercent: null, incomingVideo: 0, outgoingVideo: 0, videos: [] });

// Only RTP payload counters. Never retain/export raw ICE, SDP, addresses or identities.
export class ConnectionCounter {
  private previous = new Map<string, { bytes: number; packets: number; lost: number; frames: number; hasFrames: boolean }>();
  private started: number;
  private last: number | null = null;
  private sent = 0;
  private received = 0;
  constructor(now = performance.now()) { this.started = now; }
  sample(reports: RTCStatsReport[], now = performance.now()): ConnectionStats {
    let sent = 0, received = 0, packets = 0, lost = 0, rtt: number | null = null, jitter: number | null = null, incomingVideo = 0, outgoingVideo = 0;
    const seen = new Set<string>();
    const videos: ConnectionStats['videos'] = [];
    const seconds = this.last === null ? 0 : (now - this.last) / 1000;
    const nonnegative = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
    for (const report of reports) report.forEach(row => {
      if (row.type === 'candidate-pair' && row.state === 'succeeded' && row.nominated && typeof row.currentRoundTripTime === 'number') rtt = Math.max(rtt ?? 0, nonnegative(row.currentRoundTripTime) * 1000);
      if (!['inbound-rtp', 'outbound-rtp'].includes(row.type) || row.isRemote) return;
      const inbound = row.type === 'inbound-rtp';
      const bytes = inbound ? row.bytesReceived : row.bytesSent;
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return;
      const key = `${row.type}:${row.id}`;
      if (seen.has(key)) return; seen.add(key);
      const old = this.previous.get(key);
      const frames = inbound ? row.framesDecoded : row.framesEncoded;
      const hasLoss = typeof row.packetsReceived === 'number' && Number.isFinite(row.packetsReceived) && typeof row.packetsLost === 'number' && Number.isFinite(row.packetsLost);
      const current = { bytes, packets: hasLoss ? nonnegative(row.packetsReceived) : old?.packets ?? 0, lost: hasLoss ? nonnegative(row.packetsLost) : old?.lost ?? 0,
        frames: nonnegative(frames), hasFrames: typeof frames === 'number' && Number.isFinite(frames) };
      // Counter reset/new SSRC starts a new segment, without negative rates.
      const delta = (field: 'bytes' | 'packets' | 'lost' | 'frames') => Math.max(0, current[field] - (old && current[field] >= old[field] ? old[field] : 0));
      if (inbound) { received += delta('bytes'); if (hasLoss) { packets += delta('packets'); lost += delta('lost'); } }
      else sent += delta('bytes');
      this.previous.set(key, current);
      if (inbound && typeof row.jitter === 'number') jitter = Math.max(jitter ?? 0, nonnegative(row.jitter) * 1000);
      if ((row.kind ?? row.mediaType) === 'video') {
        if (inbound) incomingVideo++; else outgoingVideo++;
        videos.push({ direction: inbound ? 'receiving' : 'sending', width: typeof row.frameWidth === 'number' ? nonnegative(row.frameWidth) : null,
          height: typeof row.frameHeight === 'number' ? nonnegative(row.frameHeight) : null,
          fps: typeof row.framesPerSecond === 'number' && Number.isFinite(row.framesPerSecond) ? nonnegative(row.framesPerSecond) : old?.hasFrames && current.hasFrames && seconds > 0 ? delta('frames') / seconds : null });
      }
    });
    // Bound bookkeeping in unusually long sessions with many publication changes.
    if (this.previous.size > 512) for (const key of this.previous.keys()) if (!seen.has(key)) this.previous.delete(key);
    this.sent += sent; this.received += received;
    this.last = now;
    return { status: seen.size ? 'ready' : 'waiting', sampledAt: Date.now(), elapsedSeconds: Math.max(0, (now - this.started) / 1000),
      sentBytes: this.sent, receivedBytes: this.received, sendBps: seconds > 0 ? sent * 8 / seconds : null, receiveBps: seconds > 0 ? received * 8 / seconds : null,
      rttMs: rtt, jitterMs: jitter, lossPercent: packets + lost > 0 ? lost * 100 / (packets + lost) : null, incomingVideo, outgoingVideo, videos };
  }
}
