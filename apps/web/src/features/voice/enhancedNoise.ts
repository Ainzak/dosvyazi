import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';

export function enhancedNoiseSupported() {
  return typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function' && window.isSecureContext;
}

// Load only on use, from our own origin. Never send microphone samples elsewhere.
export async function createEnhancedNoise(context: AudioContext, signal: AbortSignal, failed: () => void) {
  if (!enhancedNoiseSupported() || context.sampleRate !== 48000) throw new Error('Enhanced noise processing is unavailable');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const loading = Promise.all([
    import('@sapphi-red/web-noise-suppressor'),
    fetch(wasmUrl, { signal: bounded }).then(async response => {
      if (!response.ok) throw new Error('Noise processor could not load');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 1_048_576 || !WebAssembly.validate(bytes)) throw new Error('Noise processor is invalid');
      return bytes;
    }),
    context.audioWorklet.addModule(workletUrl),
  ]);
  // addModule/import cannot be cancelled; bound the entire startup, not only fetch.
  // A cancelled late load never constructs a node or captures the microphone.
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('Noise processing cancelled', 'AbortError'));
    if (bounded.aborted) abort(); else bounded.addEventListener('abort', abort, { once: true });
  });
  const [{ RnnoiseWorkletNode }, bytes] = await Promise.race([loading, cancelled]).finally(() => bounded.removeEventListener('abort', abort));
  if (bounded.aborted || context.state === 'closed') throw new DOMException('Noise processing cancelled', 'AbortError');
  const node = new RnnoiseWorkletNode(context, { maxChannels: 1, wasmBinary: bytes });
  // Downmix stereo microphones before the one-channel processor, not afterwards.
  node.channelCount = 1; node.channelCountMode = 'explicit';
  node.addEventListener('processorerror', failed, { once: true });
  return node;
}
