/** How the interface reaches the backend: the desktop bridge or HTTP and a WebSocket. */
export type Transport = {
  request: (path: string, body?: unknown) => Promise<unknown>
  connectionStatus: () => Promise<boolean>
  onEvent: (listener: (event: unknown) => void) => () => void
  readPdf: (id: string) => Promise<ArrayBuffer>
  savePdf: (id: string) => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  /** Desktop only: the supervised backend process. */
  backendStatus?: () => Promise<unknown>
  restartBackend?: () => Promise<boolean>
  /** Browser only: try to reach the server now instead of at the next retry. */
  reconnect?: () => void
}

export const RECONNECT_MS = 2000
const timeout = (path: string) => ["acp/providers", "resume-sources/preview"].includes(path) || path.startsWith("workspace-backup/") ? 120000 : 60000

async function failure(response: Response): Promise<Error> {
  const text = await response.text()
  let message = text
  try {
    message = JSON.parse(text).error ?? text
  } catch {
    /* plain response */
  }
  return new Error(message || `Request failed (${response.status})`)
}

export function webLink(value: string): string {
  const url = new URL(value)
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Only web links can be opened")
  return url.toString()
}

/**
 * Same-origin HTTP API with a session cookie, plus one WebSocket that
 * reconnects after a drop. Every (re)connection reports `connection` and a
 * `changed` event so open screens reload.
 */
export function httpTransport(origin = window.location.origin): Transport {
  const listeners = new Set<(event: unknown) => void>()
  let session: Promise<void> | undefined
  let socket: WebSocket | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let live = false
  const emit = (event: unknown) => { for (const listener of listeners) listener(event) }
  const setLive = (value: boolean) => {
    if (live === value) return
    live = value
    emit({ type: "connection", live: value })
  }
  const ensureSession = () => session ??= fetch(new URL("/api/session", origin), { credentials: "same-origin" })
    .then(async (response) => { if (!response.ok) throw await failure(response) })
    .catch((error: unknown) => { session = undefined; throw error })
  async function call(path: string, init: RequestInit, retried = false): Promise<Response> {
    await ensureSession()
    const response = await fetch(new URL(`/api/${path}`, origin), { credentials: "same-origin", signal: AbortSignal.timeout(timeout(path)), ...init })
    // A new session (another cookie) is needed after the session file was replaced.
    if (response.status === 403 && !retried) { session = undefined; return call(path, init, true) }
    if (!response.ok) throw await failure(response)
    return response
  }
  const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  function connect() {
    clearTimeout(retry)
    if (socket || !listeners.size) return
    const later = () => { retry = setTimeout(connect, RECONNECT_MS) }
    ensureSession().then(() => {
      if (socket || !listeners.size) return
      const url = new URL("/ws", origin)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      let current: WebSocket
      try { current = new WebSocket(url) } catch { return }
      socket = current
      current.onopen = () => { if (socket !== current) return; setLive(true); emit({ type: "changed" }) }
      current.onmessage = (message) => {
        if (socket !== current) return
        try { emit(JSON.parse(String(message.data))) } catch { /* invalid frame */ }
      }
      current.onclose = () => {
        if (socket !== current) return
        socket = undefined
        setLive(false)
        later()
      }
    }, later)
  }
  return {
    request: async (path, body) => (await (body === undefined ? call(path, { method: "GET" }) : post(path, body))).json(),
    connectionStatus: async () => live,
    onEvent(listener) {
      listeners.add(listener)
      connect()
      return () => { listeners.delete(listener) }
    },
    readPdf: async (id) => (await post("application-preparation/pdf", { artifactId: id })).arrayBuffer(),
    async savePdf(id) {
      const blob = await (await post("application-preparation/pdf", { artifactId: id })).blob()
      const href = URL.createObjectURL(blob)
      const link = Object.assign(document.createElement("a"), { href, download: "resume.pdf" })
      link.click()
      setTimeout(() => URL.revokeObjectURL(href), 0)
      return true
    },
    async openExternal(value) {
      window.open(webLink(value), "_blank", "noopener,noreferrer")
    },
    reconnect() {
      session = undefined
      connect()
    },
  }
}

let override: Transport | undefined
let http: Transport | undefined
/** Tests and the desktop bridge take precedence over the browser transport. */
export function transport(): Transport {
  return override ?? window.desktop ?? (http ??= httpTransport())
}
export function setTransport(value: Transport | undefined) {
  override = value
}
