// Add a finite preview duration to this browser's own recording; the API independently validates packets/timing.
export async function prepareVoiceDraft(blob: Blob): Promise<File> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Voice recording exceeds 2 MiB. Record a shorter message.');
  const decoder = new AudioContext(); let duration: number;
  try { duration = (await decoder.decodeAudioData(bytes.buffer.slice(0))).duration * 1000; }
  catch { throw new Error('Recording could not be prepared. Record again or try another browser.'); }
  finally { await decoder.close(); }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60000) throw new Error('Record a voice message up to 60 seconds.');
  function read(offset: number) {
    function vint(position: number, id: boolean) {
      const first = bytes[position]; if (!first) throw new Error('Recording format is unavailable. Try another browser.');
      let mask = 128, width = 1; while (!(first & mask)) { mask >>= 1; width++; }
      if (position + width > bytes.length) throw new Error('Recording format is unavailable. Try another browser.');
      let value = id ? first : first & (mask - 1);
      for (let i = 1; i < width; i++) value = value * 256 + bytes[position + i]!;
      return { value, width };
    }
    const id = vint(offset, true); const size = vint(offset + id.width, false);
    const body = offset + id.width + size.width; return { id: id.value, body, end: body + size.value };
  }
  const header = read(0); const segment = read(header.end); const info = read(segment.body);
  if (header.id !== 0x1a45dfa3 || segment.id !== 0x18538067 || info.id !== 0x1549a966 || info.end > bytes.length) throw new Error('Recording format is unavailable. Try another browser.');
  const durationElement = new Uint8Array(11); durationElement.set([0x44, 0x89, 0x88]); new DataView(durationElement.buffer).setFloat64(3, duration);
  const infoHeader = new Uint8Array(12); infoHeader.set([0x15, 0x49, 0xa9, 0x66]); new DataView(infoHeader.buffer).setBigUint64(4, BigInt(info.end - info.body + 11) | (1n << 56n));
  const segmentHeader = new Uint8Array(12); segmentHeader.set([0x18, 0x53, 0x80, 0x67]);
  new DataView(segmentHeader.buffer).setBigUint64(4, BigInt(bytes.length - info.end + infoHeader.length + info.end - info.body + 11) | (1n << 56n));
  return new File([bytes.slice(0, header.end), segmentHeader, infoHeader, bytes.slice(info.body, info.end), durationElement, bytes.slice(info.end)], 'voice-message.webm', { type: 'audio/webm;codecs=opus' });
}
