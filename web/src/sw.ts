import { cacheName, respond, staleCaches, strategy } from "./lib/service-worker"

declare const __APP_VERSION__: string
type ExtendableEvent = Event & { waitUntil(promise: Promise<unknown>): void }
type FetchEvent = ExtendableEvent & { request: Request; respondWith(response: Promise<Response>): void }
const worker = self as unknown as {
  location: Location
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void
}
const current = cacheName(__APP_VERSION__)

worker.addEventListener("install", event => event.waitUntil(worker.skipWaiting()))
worker.addEventListener("activate", event => event.waitUntil((async () => {
  await Promise.all(staleCaches(await caches.keys(), current).map(name => caches.delete(name)))
  await worker.clients.claim()
})()))
worker.addEventListener("fetch", event => {
  const kind = strategy(event.request, worker.location.origin)
  if (kind) event.respondWith(caches.open(current).then(cache => respond(event.request, kind, cache)))
})
