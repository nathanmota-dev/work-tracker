export const CACHE_PREFIX = "work-tracker-"
export type Strategy = "network-first" | "cache-first"
type Cache = Pick<globalThis.Cache, "match" | "put">

export const cacheName = (version: string) => `${CACHE_PREFIX}${version}`

/**
 * Requests the worker answers. The API, the live socket and the worker itself
 * always go to the server; the page is fetched first so updates show up, and
 * the hashed files it loads are served from the cache.
 */
export function strategy(request: Request, origin: string): Strategy | undefined {
  if (request.method !== "GET") return undefined
  const url = new URL(request.url)
  if (url.origin !== origin || url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname === "/sw.js") return undefined
  if (request.mode === "navigate" || ["/", "/index.html", "/manifest.webmanifest"].includes(url.pathname)) return "network-first"
  return "cache-first"
}

/** The page is stored under "/" (routes live in the hash), so any navigation finds it offline. */
const key = (request: Request) => request.mode === "navigate" ? new URL("/", request.url).href : request

export async function respond(request: Request, kind: Strategy, cache: Cache, fetcher: typeof fetch = fetch): Promise<Response> {
  if (kind === "cache-first") {
    const hit = await cache.match(request)
    if (hit) return hit
  }
  try {
    const response = await fetcher(request)
    if (response.ok) await cache.put(key(request), response.clone())
    return response
  } catch (error) {
    const hit = kind === "network-first" ? await cache.match(key(request)) : undefined
    if (hit) return hit
    throw error
  }
}

/** Caches of other versions, removed once a new worker takes over. */
export const staleCaches = (keys: string[], current: string) => keys.filter(name => name.startsWith(CACHE_PREFIX) && name !== current)
