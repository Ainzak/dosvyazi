/* global self */
/* Network-only delivery, version 1. Never cache accounts, messages, files, API responses or app HTML.
   Installation grants no background voice or offline sending capability. */
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_REVIEWED_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Authenticated requests and API/hub/media traffic go directly through the browser.
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET' || url.origin !== self.location.origin ||
      /^\/(api|hubs|health|livekit)(\/|$)/.test(url.pathname)) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>ДоСвязи · Offline</title><style>body{background:#15191f;color:#e6edf3;font:18px system-ui;margin:0;padding:8vh 8vw}main{max-width:40rem}a{color:#91e4c1}</style><main><h1>Нет соединения / Offline</h1><p>ДоСвязи нужна сеть. Проверьте соединение и повторно откройте приложение. Переписка и файлы не сохраняются для автономного просмотра.</p><p lang="en">Dosvyazi needs a connection. Reconnect and reopen the app. Messages and files are not stored for offline viewing.</p><a href="/communities">Повторить / Retry</a></main></html>`, {
    status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
  })));
});
