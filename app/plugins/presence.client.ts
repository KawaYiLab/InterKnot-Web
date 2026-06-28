export default defineNuxtPlugin(() => {
  if (!import.meta.client) return;
  usePresence().start();
});
