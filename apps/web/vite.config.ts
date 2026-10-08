import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.DOSVYAZI_API_TARGET ?? 'http://127.0.0.1:5080';
const proxy = Object.fromEntries(['/api', '/health', '/openapi', '/hubs'].map(prefix =>
  [prefix, { target, changeOrigin: false, ws: prefix === '/hubs' }]));

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { proxy },
});
