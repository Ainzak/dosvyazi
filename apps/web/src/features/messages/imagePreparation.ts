// Decode only selected, bounded PNG/JPEG images. GIFs never pass through this path.
const previews = new WeakMap<File, Promise<Blob | null>>();
export function imageCandidate(file: File) { return /\.(png|jpe?g)$/i.test(file.name) && file.size <= 5 * 1024 * 1024; }
async function bitmap(file: File) {
  if (typeof createImageBitmap !== 'function') throw new Error('Image processing is unavailable in this browser.');
  const b = new Uint8Array(await file.arrayBuffer()); const v = new DataView(b.buffer); let w = 0, h = 0;
  if (b.length >= 33 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) { w = v.getUint32(16); h = v.getUint32(20); }
  else if (b[0] === 255 && b[1] === 216) {
    let p = 2; while (p + 4 < b.length) { if (b[p++] !== 255) break; while (b[p] === 255) p++; const m = b[p++]; if (m === 217 || m === 218) break; if (m === 1 || m! >= 208 && m! <= 215) continue; if (p + 2 > b.length) break; const size = v.getUint16(p); if (size < 2 || p + size > b.length) break; if ([192,193,194].includes(m!) && size >= 8) { h = v.getUint16(p + 3); w = v.getUint16(p + 5); break; } p += size; }
  }
  if (!w || !h || w > 4096 || h > 4096 || w * h > 12_000_000) throw new Error('This image is too large to optimize safely. Send the original instead.');
  return createImageBitmap(file);
}
async function render(file: File, side: number, quality: number, thumbnail: boolean) {
  const image = await bitmap(file); const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, side / Math.max(image.width, image.height)); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image processing is unavailable in this browser.');
    const png = /\.png$/i.test(file.name); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (type: string, value: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image processing is unavailable in this browser.')), type, value));
    let result = await encode(png ? 'image/png' : 'image/jpeg', quality);
    if (thumbnail && result.size > 96 * 1024) { context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); result = await encode('image/jpeg', 0.65); }
    return result;
  } finally { image.close(); canvas.width = 0; canvas.height = 0; }
}
export function preparePreview(file: File): Promise<Blob | null> {
  if (!imageCandidate(file)) return Promise.resolve(null);
  let pending = previews.get(file); if (!pending) { pending = render(file, 320, 0.65, true).then(b => b.size <= 96 * 1024 && b.size < file.size ? b : null).catch(() => null); previews.set(file, pending); } return pending;
}
export async function optimizeImage(file: File) {
  const blob = await render(file, 1920, 0.82, false);
  if (blob.size >= file.size) throw new Error('The original is already smaller. Keep the original file.');
  return new File([blob], file.name.replace(/\.[^.]+$/, blob.type === 'image/png' ? '.png' : '.jpg'), { type: blob.type, lastModified: file.lastModified });
}
