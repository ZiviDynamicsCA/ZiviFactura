const CACHE = 'zivifactura-v30'
const CORE = [
  '/',
  '/manifest.webmanifest?v=30',
  '/zivifactura-app-192-v29.png?v=30',
  '/zivifactura-app-v28.png?v=30',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.allSettled(CORE.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' })
      if (response.ok) await cache.put(url, response)
    }))
  })())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request)
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put('/', response.clone())
        }
        return response
      } catch {
        return (await caches.match('/')) || Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request)
    try {
      const response = await fetch(event.request)
      if (response.ok) {
        const cache = await caches.open(CACHE)
        await cache.put(event.request, response.clone())
      }
      return response
    } catch {
      return cached || Response.error()
    }
  })())
})
