/**
 * InterKnot media cache — cache-first for images/fonts/static media only.
 * All /api/* requests bypass Cache Storage (network-only) so discussion data always comes from the server.
 */
const CACHE_NAME = "ik-media-v1";
const CACHE_PREFIX = "ik-media-";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * @param {string} url
 */
function isApiRequest(url) {
  try {
    return new URL(url).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * @param {Request} request
 */
function isMediaResource(request) {
  if (request.method !== "GET") return false;
  const dest = request.destination;
  if (dest === "image" || dest === "font") return true;
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname.includes("/uploads/")) return true;
    return /\.(webp|avif|jpg|jpeg|png|gif|svg|woff2?|ico)$/i.test(pathname);
  } catch {
    return false;
  }
}

/**
 * @param {Request} request
 */
async function cacheFirstMedia(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Quota or unsupported response — still return live response
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = request.url;
  if (isApiRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (isMediaResource(request)) {
    event.respondWith(
      cacheFirstMedia(request).catch(() => fetch(request)),
    );
  }
});
