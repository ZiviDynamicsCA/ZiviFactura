const CACHE = 'zivifactura-shell-v32'
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/zivifactura-app-192-v29.png',
  '/zivifactura-app-v28.png',
]

self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      for (const url of APP_SHELL) {
        try { await cache.add(new Request(url, { cache: 'reload' })) } catch (_) {}
      }
    }),
  )
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
    const cached = await caches.match(request)
    if (cached) return cached
    try {
      const fresh = await fetch(request)
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE)
        cache.put(request, fresh.clone()).catch(() => undefined)
      }
      return fresh
    } catch (_) {
      return Response.error()
    }
  })())
})
