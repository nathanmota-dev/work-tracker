import { afterEach, expect, it, vi } from "vitest"
import { cacheName, respond, staleCaches, strategy } from "./service-worker"
import { registerServiceWorker } from "./register-service-worker"

const origin = "http://127.0.0.1:47830"
const get = (path: string, mode: RequestMode = "cors") => Object.defineProperty(new Request(`${origin}${path}`), "mode", { value: mode })
function cache() {
  const entries = new Map<string, Response>()
  const keyOf = (key: RequestInfo | URL) => typeof key === "string" ? key : key instanceof URL ? key.href : key.url
  return {
    entries,
    match: vi.fn(async (key: RequestInfo | URL) => entries.get(keyOf(key))?.clone()),
    put: vi.fn(async (key: RequestInfo | URL, response: Response) => { entries.set(keyOf(key), response) }),
  }
}
afterEach(() => { vi.unstubAllGlobals() })

it("never answers the API, the socket, the worker, writes or other sites", () => {
  for (const path of ["/api/jobs", "/api/session", "/ws", "/sw.js"]) expect(strategy(get(path), origin)).toBeUndefined()
  expect(strategy(new Request(`${origin}/assets/app.js`, { method: "POST" }), origin)).toBeUndefined()
  expect(strategy(new Request("https://cdn.example/app.js"), origin)).toBeUndefined()
  expect(strategy(get("/", "navigate"), origin)).toBe("network-first")
  expect(strategy(get("/manifest.webmanifest"), origin)).toBe("network-first")
  expect(strategy(get("/assets/index-abc.js"), origin)).toBe("cache-first")
})

it("fetches the page first, stores it under / and falls back to it offline", async () => {
  const store = cache()
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("v2")).mockRejectedValueOnce(new TypeError("offline"))
  expect(await (await respond(get("/?x=1", "navigate"), "network-first", store, fetcher)).text()).toBe("v2")
  expect([...store.entries.keys()]).toEqual([`${origin}/`])
  expect(await (await respond(get("/", "navigate"), "network-first", store, fetcher)).text()).toBe("v2")
  fetcher.mockRejectedValueOnce(new TypeError("offline"))
  await expect(respond(get("/manifest.webmanifest"), "network-first", store, fetcher)).rejects.toThrow("offline")
})

it("serves stored files without the network and stores only successful responses", async () => {
  const store = cache()
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("asset")).mockResolvedValueOnce(new Response("missing", { status: 404 }))
  expect(await (await respond(get("/assets/a.js"), "cache-first", store, fetcher)).text()).toBe("asset")
  expect(await (await respond(get("/assets/a.js"), "cache-first", store, fetcher)).text()).toBe("asset")
  expect(fetcher).toHaveBeenCalledOnce()
  expect((await respond(get("/assets/b.js"), "cache-first", store, fetcher)).status).toBe(404)
  expect(store.entries.has(`${origin}/assets/b.js`)).toBe(false)
  fetcher.mockRejectedValueOnce(new TypeError("offline"))
  await expect(respond(get("/assets/c.js"), "cache-first", store, fetcher)).rejects.toThrow("offline")
})

it("removes only this app's caches of other versions", () => {
  expect(staleCaches(["work-tracker-0.9.0", cacheName("1.0.0"), "other-app"], cacheName("1.0.0"))).toEqual(["work-tracker-0.9.0"])
})

it("registers the worker only for the production browser app", async () => {
  const register = vi.fn().mockResolvedValue({})
  vi.stubGlobal("navigator", { serviceWorker: { register } })
  expect(registerServiceWorker({ production: false, desktop: false })).toBe(false)
  expect(registerServiceWorker({ production: true, desktop: true })).toBe(false)
  expect(registerServiceWorker({ production: true, desktop: false })).toBe(true)
  expect(register).toHaveBeenCalledWith("/sw.js")
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  register.mockRejectedValueOnce(new Error("blocked"))
  registerServiceWorker({ production: true, desktop: false })
  await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("Offline support is unavailable:", expect.any(Error)))
  vi.stubGlobal("navigator", {})
  expect(registerServiceWorker({ production: true, desktop: false })).toBe(false)
  expect(registerServiceWorker()).toBe(false)
})
