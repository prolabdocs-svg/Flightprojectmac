// PWA service worker (spec 46.2 / 158). Hand-maintained (no vite-plugin-pwa in this vertical
// slice yet — spec 158.1 calls that out as the longer-term path via injectManifest). Implements
// four request strategies instead of one blanket cache-then-network:
//
//   - Precache:                 app shell (HTML, boot JS/CSS, manifest, icons) — spec 46.2 core list.
//   - Cache-on-demand:          same-origin static assets fetched during play (regions, audio,
//                                textures, replay media) — cached the first time they're requested,
//                                served from cache thereafter, cache-first.
//   - Network-first:            leaderboard / daily-challenge / account / cloud endpoints — spec
//                                46.2 + 158.2. Always try the network so data stays fresh; fall
//                                back to cache only when offline.
//   - Stale-while-revalidate:   noncritical remote config / news-event style endpoints — serve
//                                the cached copy immediately (if any) while refreshing in the
//                                background.
//
// Bump CACHE_VERSION whenever cache semantics or SHELL_URLS change so old precaches are
// dropped on activate. Vite hashes entry chunks per build: serving an old cached HTML
// document after deployment can otherwise reference chunks that no longer exist.

const CACHE_VERSION = 'v4';
const SHELL_CACHE = `project-flight-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `project-flight-runtime-${CACHE_VERSION}`;
const NETWORK_FIRST_CACHE = `project-flight-network-first-${CACHE_VERSION}`;
const SWR_CACHE = `project-flight-swr-${CACHE_VERSION}`;

const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE, NETWORK_FIRST_CACHE, SWR_CACHE];

// Spec 46.2 precache list: HTML shell, boot JS, CSS, fonts, minimal UI, starter aircraft/garage,
// tutorial region. This vertical slice bundles boot JS/CSS/UI into the Vite build output under
// /assets/*, which isn't known at author time — those get swept into the shell cache on first
// fetch via the install-time addAll below for the entry points we do know, plus opportunistic
// caching of same-origin /assets/* responses (see handleShellAsset).
const SHELL_URLS = ['/', '/offline.html', '/manifest.json', '/favicon.svg', '/icon-192.svg', '/icon-512.svg'];

// Same-origin path patterns treated as network-first (spec 46.2: leaderboard, daily challenge
// config, account/cloud) and stale-while-revalidate (noncritical remote config, news/event cards).
// This slice has no backend yet, but the routing is wired so adding real endpoints later doesn't
// require touching the fetch handler.
const NETWORK_FIRST_PATTERNS = [/\/api\/leaderboard/, /\/api\/daily/, /\/api\/account/, /\/api\/cloud/];
const STALE_WHILE_REVALIDATE_PATTERNS = [/\/api\/config/, /\/api\/news/, /\/api\/events/];

// Content that should never be cached (spec 158.2 "never cache blindly").
const NEVER_CACHE_PATTERNS = [/\/api\/score/, /\/api\/auth/, /\/api\/admin/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch((err) => console.warn('[sw] shell precache failed', err)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function matchesAny(url, patterns) {
  return patterns.some((re) => re.test(url));
}

/** Cache-first with background cache-on-demand population for same-origin static assets. */
async function handleCacheOnDemand(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (cached) return cached;
    // A branded, actionable offline screen is substantially better than the browser's
    // generic network error for a PWA navigation that was not cached previously.
    if (request.mode === 'navigate') {
      const shell = await caches.open(SHELL_CACHE);
      return (await shell.match('/offline.html')) ?? Response.error();
    }
    throw err;
  }
}

/** A navigation must prefer the newest HTML document. Static build chunks are content-hashed,
 * so cache-first HTML can strand a returning player on an old entry point whose chunks were
 * removed by a deployment. Offline still falls back to the last good shell. */
async function handleNavigation(request) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) shell.put(request, response.clone());
    return response;
  } catch {
    return (await shell.match(request)) ?? (await shell.match('/')) ?? (await shell.match('/offline.html')) ?? Response.error();
  }
}

/** Network-first: prefer fresh data, fall back to last-known cache when offline. */
async function handleNetworkFirst(request) {
  const cache = await caches.open(NETWORK_FIRST_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

/** Stale-while-revalidate: serve cached immediately, refresh in the background. */
function handleStaleWhileRevalidate(request) {
  return caches.open(SWR_CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  const url = request.url;

  if (matchesAny(url, NEVER_CACHE_PATTERNS)) {
    // Let these go straight to the network untouched.
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (matchesAny(url, NETWORK_FIRST_PATTERNS)) {
    event.respondWith(handleNetworkFirst(request));
    return;
  }

  if (matchesAny(url, STALE_WHILE_REVALIDATE_PATTERNS)) {
    event.respondWith(handleStaleWhileRevalidate(request));
    return;
  }

  // Content-hashed static build assets: cache-first, populate on demand.
  event.respondWith(handleCacheOnDemand(request));
});

// Update UX (spec 158.3): the page can ask the waiting worker to activate immediately once the
// user confirms an "update ready" prompt, instead of the worker forcing a reload mid-flight.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
