export default defineNuxtPlugin(() => {
  if (!import.meta.client || !("serviceWorker" in navigator)) return;

  const config = useRuntimeConfig();
  const enabled = import.meta.env.PRODUCTION === true || config.public.enableServiceWorker === true;

  if (!enabled) return;

  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Registration can fail on unsupported hosts or during transient errors
  });
});
