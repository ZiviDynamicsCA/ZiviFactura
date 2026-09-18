const CACHE = 'zivifactura-shell-v61'
const APP_SHELL = [
  '/manifest.webmanifest?v=61',
  '/zivifactura-app-192-v43.png?v=61',
  '/zivifactura-app-512-v56.svg?v=61',
]

async function cacheCurrentBuild(cache) {
  try {
    const response = await fetch(new Request('/', { cache: 'reload' }))
    if (!response.ok) return

    const cachedResponse = response.clone()
    const html = await response.text()
    await cache.put('/', cachedResponse)

    const assets = [...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
      .map(match => match[1])
      .filter(url => url.startsWith('/assets/') || url.startsWith('/src/'))

    await Promise.allSettled(
      [...new Set(assets)].map(url => cache.add(new Request(url, { cache: 'reload' }))),
    )
  } catch (_) {
    // A failed pre-cache must not make installation fail.
  }
}

self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cacheCurrentBuild(cache)
    await Promise.allSettled(
      APP_SHELL.map(url => cache.add(new Request(url, { cache: 'reload' }))),
    )
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request)
        const cache = await caches.open(CACHE)
        cache.put('/', fresh.clone()).catch(() => undefined)
        return fresh
      } catch (_) {
        return (await caches.match('/')) || Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request)
      if (fresh && fresh.ok && (fresh.type === 'basic' || fresh.type === 'cors')) {
        const cache = await caches.open(CACHE)
        cache.put(request, fresh.clone()).catch(() => undefined)
      }
      return fresh
    } catch (_) {
      const cached = await caches.match(request)
      return cached || Response.error()
    }
  })())
})
