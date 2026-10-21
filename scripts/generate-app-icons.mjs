// Reproducible PNG rendition of the existing AudioLines application mark. No external assets.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const destination = new URL('../apps/web/public/icons/', import.meta.url);
await mkdir(destination, { recursive: true });
function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(type, bytes) { const content = Buffer.concat([Buffer.from(type), bytes]); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(content)); return Buffer.concat([length, content, checksum]); }
for (const [size, name] of [[192, 'app-192.png'], [512, 'app-512.png'], [512, 'app-maskable-512.png']]) {
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const heights = [0.13, 0.28, 0.42, 0.24, 0.12]; let ink = false;
    for (let bar = 0; bar < 5; bar++) {
      const cx = 0.5 + (bar - 2) * 0.085, half = heights[bar] / 2;
      const dx = Math.max(Math.abs(px - cx) - 0.019, 0), dy = Math.max(Math.abs(py - 0.5) - half + 0.019, 0);
      if (dx * dx + dy * dy < 0.019 ** 2) ink = true;
    }
    const index = y * (size * 3 + 1) + 1 + x * 3;
    rows.set(ink ? [145, 228, 193] : [21, 25, 31], index);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(new URL(name, destination), png);
}
