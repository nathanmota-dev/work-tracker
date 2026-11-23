import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  send: vi.fn(),
}))
const sockets = vi.hoisted(() => [] as { url: string; emit(event: string, ...args: unknown[]): boolean; close: () => void }[])
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: electron.send } }] },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler) },
  shell: { openExternal: vi.fn() },
  dialog: {},
}))
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events")
  class FakeSocket extends EventEmitter {
    readonly close = vi.fn(() => { this.emit("close") })
    readonly url: string
    constructor(url: URL) {
      super()
      this.url = url.href
      sockets.push(this)
    }
  }
  return { default: FakeSocket }
})
const { closeApiBridge, connectApiBridge, emitBackendState, registerApiBridge } = await import("./api-bridge")
const events = () => electron.send.mock.calls.map(call => call[1])
const backend = { state: vi.fn(() => ({ status: "ready" as const, restarts: 0, failures: 0, logPath: "/logs/backend.log" })), restart: vi.fn(() => true) }
registerApiBridge(backend)

describe("api bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sockets.length = 0
  })
  afterEach(() => {
    closeApiBridge()
    electron.send.mockClear()
    vi.unstubAllGlobals()
  })

  it("exposes the backend state and restart action", async () => {
    expect(electron.handlers.get("backend:status")!()).toMatchObject({ status: "ready" })
    expect(electron.handlers.get("backend:restart")!()).toBe(true)
    expect(backend.restart).toHaveBeenCalledOnce()
    emitBackendState({ status: "unavailable", restarts: 0, failures: 1, logPath: "/logs/backend.log" })
    expect(events()).toEqual([{ type: "backend", state: expect.objectContaining({ status: "unavailable" }) }])
  })

  it("reconnects to a new backend without duplicated sockets or events", async () => {
    connectApiBridge({ address: "http://127.0.0.1:4000", token: "old" })
    const old = sockets[0]!
    old.emit("open")
    expect(await electron.handlers.get("api:status")!()).toBe(true)
    closeApiBridge("The backend stopped unexpectedly (exit code 9). Restart the backend to continue.")
    expect(old.close).toHaveBeenCalledOnce()
    await expect(electron.handlers.get("api:request")!({}, "jobs")).rejects.toThrow("Restart the backend to continue.")
    // A closed connection does not keep retrying the old port.
    vi.advanceTimersByTime(10_000)
    expect(sockets).toHaveLength(1)

    connectApiBridge({ address: "http://127.0.0.1:4001", token: "new" })
    expect(sockets).toHaveLength(2)
    expect(sockets[1]!.url).toBe("ws://127.0.0.1:4001/ws?token=new")
    const current = sockets[1]!
    current.emit("open")
    old.emit("message", Buffer.from(JSON.stringify({ type: "changed", table: "stale" })))
    current.emit("message", Buffer.from(JSON.stringify({ type: "changed", table: "jobs" })))
    current.emit("message", Buffer.from("not json"))
    expect(events()).toEqual([
      { type: "connection", live: true },
      { type: "changed" },
      { type: "connection", live: false },
      { type: "connection", live: true },
      { type: "changed" },
      { type: "changed", table: "jobs" },
    ])
  })

  it("retries only the current socket after a transient close", () => {
    connectApiBridge({ address: "http://127.0.0.1:4000", token: "first" })
    connectApiBridge({ address: "http://127.0.0.1:4001", token: "second" })
    const [first, second] = sockets
    first!.emit("close")
    second!.emit("error")
    expect(second!.close).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(2000)
    expect(sockets).toHaveLength(3)
    expect(sockets[2]!.url).toContain("token=second")
  })
  it("allows batch review reads and adjustment writes while rejecting arbitrary paths and methods", async () => {
    connectApiBridge({ address: "http://127.0.0.1:4000", token: "fixture" })
    const fetch = vi.fn(async () => new Response('{"ok":true}'))
    vi.stubGlobal("fetch", fetch)
    const request = electron.handlers.get("api:request")!
    const path = "preparation-batches/review/12345678-1234-1234-1234-123456789abc"
    expect(await request({}, path)).toEqual({ ok: true })
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: `/api/${path}` }), expect.objectContaining({ method: "GET" }))
    expect(await request({}, "preparation-batches/adjust", { adjustment: "React" })).toEqual({ ok: true })
    expect(fetch).toHaveBeenLastCalledWith(expect.any(URL), expect.objectContaining({ method: "POST", body: '{"adjustment":"React"}' }))
    for (const invalid of ["preparation-batches/review/../jobs", "preparation-batches/review/%2e%2e", "preparation-batches/review/", "preparation-batches/adjust"])
      await expect(request({}, invalid)).rejects.toThrow("Unsupported API request")
    await expect(request({}, path, {})).rejects.toThrow("Unsupported API request")
  })
  it("allows reading the interview packs of one application only", async () => {
    connectApiBridge({ address: "http://127.0.0.1:4000", token: "fixture" })
    const fetch = vi.fn(async () => new Response("[]"))
    vi.stubGlobal("fetch", fetch)
    const request = electron.handlers.get("api:request")!
    expect(await request({}, "interview-preps")).toEqual([])
    expect(await request({}, "interview-preps/12")).toEqual([])
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: "/api/interview-preps/12" }), expect.objectContaining({ method: "GET" }))
    for (const invalid of ["interview-preps/0", "interview-preps/1/extra", "interview-preps/abc", "interview-preps?applicationId=1"])
      await expect(request({}, invalid)).rejects.toThrow("Unsupported API request")
    await expect(request({}, "interview-preps", {})).rejects.toThrow("Unsupported API request")
  })
  it("allows the quiet scan with an optional numeric threshold and its resolve write", async () => {
    connectApiBridge({ address: "http://127.0.0.1:4000", token: "fixture" })
    const fetch = vi.fn(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetch)
    const request = electron.handlers.get("api:request")!
    expect(await request({}, "application-board/quiet")).toEqual({})
    expect(await request({}, "application-board/quiet?days=90")).toEqual({})
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: "/api/application-board/quiet", search: "?days=90&token=fixture" }), expect.objectContaining({ method: "GET" }))
    expect(await request({}, "application-board/quiet/resolve", { ids: [1] })).toEqual({})
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: "/api/application-board/quiet/resolve" }), expect.objectContaining({ method: "POST", body: '{"ids":[1]}' }))
    for (const invalid of ["application-board/quiet?days=", "application-board/quiet?days=0", "application-board/quiet?days=12345", "application-board/quiet?days=9&x=1", "application-board/quiet/resolve"])
      await expect(request({}, invalid)).rejects.toThrow("Unsupported API request")
    await expect(request({}, "application-board/quiet", {})).rejects.toThrow("Unsupported API request")
  })
  it("allows reading the cached research of one company and invalidating it", async () => {
    connectApiBridge({ address: "http://127.0.0.1:4000", token: "fixture" })
    const fetch = vi.fn(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetch)
    const request = electron.handlers.get("api:request")!
    expect(await request({}, "company-research?company=Acme%20Corp")).toEqual({})
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: "/api/company-research", search: "?company=Acme+Corp&token=fixture" }), expect.objectContaining({ method: "GET" }))
    expect(await request({}, "company-research/invalidate", { company: "Acme Corp" })).toEqual({})
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: "/api/company-research/invalidate" }), expect.objectContaining({ method: "POST", body: '{"company":"Acme Corp"}' }))
    for (const invalid of ["company-research", "company-research?company=", "company-research?company=Acme&token=x", "company-research/invalidate"])
      await expect(request({}, invalid)).rejects.toThrow("Unsupported API request")
    await expect(request({}, "company-research?company=Acme", {})).rejects.toThrow("Unsupported API request")
  })
})
