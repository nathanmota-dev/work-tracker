/// <reference types="vite/client" />
interface Window {
  desktop?: {
    getVersion: () => Promise<string>
    request: (path: string, body?: unknown) => Promise<unknown>
    connectionStatus: () => Promise<boolean>
    openExternal: (url: string) => Promise<void>
    onEvent: (listener: (event: unknown) => void) => () => void
  }
}
