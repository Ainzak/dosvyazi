import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const target = process.env.DOSVYAZI_API_TARGET ?? 'http://127.0.0.1:5080';
const proxy = Object.fromEntries(['/api', '/health', '/openapi', '/hubs'].map(prefix =>
  [prefix, { target, changeOrigin: false, ws: prefix === '/hubs' }]));

export default defineConfig({
  plugins: [react(), {
    name: 'delivery-worker-release',
    apply: 'build',
    writeBundle(options, bundle) {
      // Change the worker bytes with each changed bundle so an open client can review an update.
      // No precache list or private data is introduced.
      const release = createHash('sha256').update(Object.keys(bundle).sort().map(name => {
        const item = bundle[name]!; return item.type === 'chunk' ? item.code : item.source;
      }).join('\n')).digest('hex');
      const output = path.resolve(fileURLToPath(new URL('.', import.meta.url)), options.dir ?? 'dist', 'sw.js');
      const worker = readFileSync(new URL('public/sw.js', import.meta.url), 'utf8');
      writeFileSync(output, `// App bundle ${release}\n${worker}`);
    },
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { proxy },
});
