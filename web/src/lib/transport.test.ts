import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { RECONNECT_MS, httpTransport, setTransport, transport, webLink } from "./transport"
import { desktopDouble } from "@/test/doubles"

const origin = "http://127.0.0.1:47830"
class FakeSocket {
  static all: FakeSocket[] = []
  onopen?: () => void
  onmessage?: (message: { data: unknown }) => void
  onclose?: () => void
  constructor(readonly url: URL) { FakeSocket.all.push(this) }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const session = () => json({ ok: true, version: "1.0.0" })
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>
const paths = () => fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
beforeEach(() => {
  FakeSocket.all = []
  fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal("fetch", fetch)
  vi.stubGlobal("WebSocket", FakeSocket)
})
afterEach(() => {
  setTransport(undefined)
  delete window.desktop
  vi.useRealTimers()
})

it("opens one session, then reads with GET and writes JSON with POST", async () => {
  fetch.mockResolvedValueOnce(session()).mockResolvedValueOnce(json([{ id: 1 }])).mockResolvedValueOnce(json({ ok: true }))
  const http = httpTransport(origin)
  expect(await http.request("jobs")).toEqual([{ id: 1 }])
  expect(await http.request("answer", { key: "name" })).toEqual({ ok: true })
  expect(paths()).toEqual(["/api/session", "/api/jobs", "/api/answer"])
  expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "GET", credentials: "same-origin" })
  expect(fetch.mock.calls[2]![1]).toMatchObject({ method: "POST", headers: { "content-type": "application/json" }, body: '{"key":"name"}' })
})

it("gives slow operations two minutes and everything else one", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout")
  fetch.mockImplementation(async (url) => new URL(String(url)).pathname === "/api/session" ? session() : json({}))
  const http = httpTransport(origin)
  for (const path of ["acp/providers", "resume-sources/preview", "workspace-backup/create", "jobs"]) await http.request(path, path === "jobs" ? undefined : {})
  expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([120000, 120000, 120000, 60000])
})

it("reports the backend's error, plain text or the status", async () => {
  fetch.mockResolvedValueOnce(session())
    .mockResolvedValueOnce(json({ error: "Finish the active execution first." }, 409))
    .mockResolvedValueOnce(new Response("not found", { status: 404 }))
    .mockResolvedValueOnce(new Response("", { status: 500 }))
  const http = httpTransport(origin)
  await expect(http.request("acp/run", {})).rejects.toThrow("Finish the active execution first.")
  await expect(http.request("missing")).rejects.toThrow("not found")
  await expect(http.request("jobs")).rejects.toThrow("Request failed (500)")
})

it("renews the session once after a rejected cookie and retries a failed session later", async () => {
  fetch.mockResolvedValueOnce(session()).mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
    .mockResolvedValueOnce(session()).mockResolvedValueOnce(json(["renewed"]))
  const http = httpTransport(origin)
  expect(await http.request("jobs")).toEqual(["renewed"])
  expect(paths()).toEqual(["/api/session", "/api/jobs", "/api/session", "/api/jobs"])
  fetch.mockReset().mockResolvedValueOnce(new Response("forbidden", { status: 403 })).mockResolvedValueOnce(session()).mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
  await expect(http.request("jobs")).rejects.toThrow("forbidden")
  expect(paths()).toEqual(["/api/jobs", "/api/session", "/api/jobs"])
  const down = httpTransport(origin)
  fetch.mockReset().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(session()).mockResolvedValueOnce(json([]))
  await expect(down.request("jobs")).rejects.toThrow("Failed to fetch")
  expect(await down.request("jobs")).toEqual([])
})

it("reads PDFs and downloads them as resume.pdf", async () => {
  fetch.mockImplementation(async (url) => new URL(String(url)).pathname === "/api/session" ? session() : new Response(new Uint8Array([37, 80, 68, 70])))
  const create = vi.fn(() => "blob:resume"), revoke = vi.fn()
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("resume.pdf")
    expect(this.href).toBe("blob:resume")
  })
  const http = httpTransport(origin)
  expect(new Uint8Array(await http.readPdf("pdf-1"))).toEqual(new Uint8Array([37, 80, 68, 70]))
  expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "POST", body: '{"artifactId":"pdf-1"}' })
  expect(await http.savePdf("pdf-1")).toBe(true)
  expect(click).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:resume"))
})

it("opens only web links in a new tab", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null)
  const http = httpTransport(origin)
  await http.openExternal("https://example.com/jobs/1")
  expect(open).toHaveBeenCalledWith("https://example.com/jobs/1", "_blank", "noopener,noreferrer")
  await expect(http.openExternal("javascript:alert(1)")).rejects.toThrow("Only web links")
  expect(() => webLink("file:///etc/passwd")).toThrow("Only web links")
})

it("keeps one socket, forwards events, reloads on connect and reconnects only the current socket", async () => {
  vi.useFakeTimers()
  fetch.mockImplementation(async () => session())
  const http = httpTransport(origin)
  const events: unknown[] = []
  const stop = http.onEvent(event => events.push(event))
  http.onEvent(() => {})
  await flush()
  expect(FakeSocket.all).toHaveLength(1)
  const first = FakeSocket.all[0]!
  expect(first.url.href).toBe("ws://127.0.0.1:47830/ws")
  first.onopen!()
  expect(await http.connectionStatus()).toBe(true)
  first.onmessage!({ data: '{"type":"changed","table":"jobs"}' })
  first.onmessage!({ data: "not json" })
  expect(events).toEqual([{ type: "connection", live: true }, { type: "changed" }, { type: "changed", table: "jobs" }])
  first.onclose!()
  expect(events.at(-1)).toEqual({ type: "connection", live: false })
  await vi.advanceTimersByTimeAsync(RECONNECT_MS)
  expect(FakeSocket.all).toHaveLength(2)
  first.onmessage!({ data: '{"type":"stale"}' })
  first.onclose!()
  await vi.advanceTimersByTimeAsync(RECONNECT_MS)
  expect(FakeSocket.all).toHaveLength(2)
  expect(events).not.toContainEqual({ type: "stale" })
  stop()
})

it("retries an unreachable server and reconnects at once on request", async () => {
  vi.useFakeTimers()
  fetch.mockRejectedValue(new TypeError("Failed to fetch"))
  const http = httpTransport(origin)
  http.onEvent(() => {})
  await vi.advanceTimersByTimeAsync(RECONNECT_MS * 2)
  expect(paths()).toEqual(["/api/session", "/api/session", "/api/session"])
  fetch.mockReset().mockResolvedValue(session())
  http.reconnect!()
  await flush()
  expect(FakeSocket.all).toHaveLength(1)
})

it("does not retry a socket the browser refuses to create", async () => {
  vi.useFakeTimers()
  fetch.mockResolvedValue(session())
  vi.stubGlobal("WebSocket", class { constructor() { throw new SyntaxError("bad url") } })
  const http = httpTransport(origin)
  http.onEvent(() => {})
  await vi.advanceTimersByTimeAsync(RECONNECT_MS * 3)
  expect(paths()).toEqual(["/api/session"])
})

it("prefers a test transport, then the desktop bridge, then HTTP", () => {
  const desktop = desktopDouble()
  window.desktop = desktop
  expect(transport()).toBe(desktop)
  const double = desktopDouble()
  setTransport(double)
  expect(transport()).toBe(double)
  setTransport(undefined)
  delete window.desktop
  expect(transport()).toBe(transport())
  expect(transport().reconnect).toBeTypeOf("function")
})
