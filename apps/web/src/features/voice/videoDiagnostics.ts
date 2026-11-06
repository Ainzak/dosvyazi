export type VideoDiagnostics = {
  interval: 'baseline' | 'updating' | 'stale' | 'reset'; intervalSeconds: number | null;
  fps: number | null; captureFps: number | null; processingMsPerFrame: number | null;
  droppedFrames: number | null; freezes: number | null; freezeMs: number | null;
  limitation: 'none' | 'cpu' | 'bandwidth' | 'other' | null;
};
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
type Point = { at: number; timestamp: number | null; frames: number | null; processing: number | null; dropped: number | null; freezes: number | null; freezeSeconds: number | null; sourceFrames: number | null };

// Keep raw report IDs only in transient bookkeeping, never in a returned report.
export class VideoDiagnosticCounter {
  private previous = new Map<string, Point>();
  sample(key: string, row: Record<string, unknown>, source: Record<string, unknown> | undefined, now: number): VideoDiagnostics {
    const inbound = row.type === 'inbound-rtp';
    const point: Point = { at: now, timestamp: finite(row.timestamp), frames: finite(inbound ? row.framesDecoded : row.framesEncoded),
      processing: finite(inbound ? row.totalDecodeTime : row.totalEncodeTime), dropped: finite(row.framesDropped), freezes: finite(row.freezeCount),
      freezeSeconds: finite(row.totalFreezesDuration), sourceFrames: finite(source?.frames) };
    const old = this.previous.get(key), seconds = old ? (now - old.at) / 1000 : 0;
    const stale = !!old && (seconds <= 0 || (point.timestamp !== null && old.timestamp !== null && point.timestamp === old.timestamp));
    const fields = ['frames', 'processing', 'dropped', 'freezes', 'freezeSeconds', 'sourceFrames'] as const;
    const reset = !!old && ((point.timestamp !== null && old.timestamp !== null && point.timestamp < old.timestamp) || fields.some(k => point[k] !== null && old[k] !== null && point[k]! < old[k]!));
    const valid = !!old && !stale && !reset && seconds > 0;
    const delta = (key: typeof fields[number]) => valid && old[key] !== null && point[key] !== null ? point[key]! - old[key]! : null;
    const frames = delta('frames'), processing = delta('processing'), sourceFrames = delta('sourceFrames'), frozen = delta('freezeSeconds');
    const limitation = !inbound && ['none', 'cpu', 'bandwidth', 'other'].includes(String(row.qualityLimitationReason)) ? row.qualityLimitationReason as VideoDiagnostics['limitation'] : null;
    if (!stale) this.previous.set(key, point);
    return { interval: stale ? 'stale' : reset ? 'reset' : valid ? 'updating' : 'baseline', intervalSeconds: valid ? seconds : null,
      fps: stale ? null : finite(row.framesPerSecond) ?? (frames === null ? null : frames / seconds),
      captureFps: inbound || stale ? null : finite(source?.framesPerSecond) ?? (sourceFrames === null ? null : sourceFrames / seconds),
      processingMsPerFrame: processing === null || frames === null || frames <= 0 ? null : processing * 1000 / frames,
      droppedFrames: inbound ? delta('dropped') : null, freezes: inbound ? delta('freezes') : null, freezeMs: inbound && frozen !== null ? frozen * 1000 : null,
      limitation: stale ? null : limitation };
  }
  retain(keys: Set<string>) { for (const key of this.previous.keys()) if (!keys.has(key)) this.previous.delete(key); }
}
