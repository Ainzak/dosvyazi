# Installable browser application

Production builds include a web app manifest, reproducible 192/512 PNG icons (including a maskable icon), and a network-only service worker. Open **About this build → Install Dosvyazi**. When the browser supplies an installation prompt, the page exposes **Install app**; otherwise it explains the browser menu path. Dismissing the prompt leaves browser use available. Launch URL is `/communities`, same-origin scope `/`, with standalone display. Account authentication remains the existing cookie session.

There is no separate Windows installer or Android APK. Browser installation support varies; use the normal site if installation is unavailable. Manifest requirements and `beforeinstallprompt` handling follow [MDN installability guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). Edge installation behavior is described by [Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/ux).

## Network, updates and privacy

The worker never uses Cache Storage, IndexedDB, offline queues, background sync or push. API, hubs, health and LiveKit requests are not intercepted. Same-origin page navigation goes to the network; a transport failure returns a static bilingual offline page with Retry. No account names, messages, files, tokens or route-derived content enter that response. An online 401/403/5xx response is not replaced by cached success. Existing in-memory query caches and browser storage preferences are unchanged; this is not a claim that the browser stores no data at all.

Every changed production bundle changes worker bytes. Updates wait for an explicit reload; no automatic page reload ends a voice session. About shows a waiting update with a confirmation explaining that reloading ends the current window's voice and loses drafts. Other open windows are not reloaded by the update. Do not close/reload until your work is saved. The current worker has no private caches to clear on logout.

The VPS sends no-store for the rewritten app HTML, manifest and worker. Caddy's explicit [route ordering](https://caddyserver.com/docs/caddyfile/directives/route) places the HTML fallback rewrite before the header matcher, covering deep links as well as `/index.html`. Hashed assets and icons keep their ordinary HTTP behavior; the worker does not cache them.

Calling, microphone/camera permissions, screen capture and browser autoplay follow the same rules as the site. Installation does not add global push-to-talk, guaranteed background/locked-phone calls, offline messaging, push notifications or mobile screen-capture support. Keep the app open for voice. Test physical devices and required browsers separately before relying on background behavior.

## Reproducibility and verification

`node scripts/generate-app-icons.mjs` reproduces the original application's AudioLines mark without external assets or packages. Vite stamps the worker with a SHA256 of emitted bundle content; it does not precache that content. Use `npm run build:web` and the existing preview/VPS origin to verify the manifest, icons, worker control, offline/reconnect, deliberate installation and reviewed update behavior. Development HMR does not register the worker. Native OS installation, real Edge/Android audio and lock-screen behavior require separate device acceptance; a mobile viewport is not a physical Android test.
