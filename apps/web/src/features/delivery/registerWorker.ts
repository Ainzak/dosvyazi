export function registerDeliveryWorker() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => { /* Browser delivery still works when installation is blocked. */ });
  }
}
