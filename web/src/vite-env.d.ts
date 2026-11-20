/// <reference types="vite/client" />
interface Window {
  desktop?: {
    readPdf: (id: string) => Promise<ArrayBuffer>
    savePdf: (id: string) => Promise<boolean>
    chooseSource: (kind: "folder" | "data") => Promise<string | null>
    getVersion: () => Promise<string>
    request: (path: string, body?: unknown) => Promise<unknown>
    connectionStatus: () => Promise<boolean>
    backendStatus?: () => Promise<unknown>
    restartBackend?: () => Promise<boolean>
    openExternal: (url: string) => Promise<void>
    updates?: import("@/types/updates").UpdatesBridge
    onEvent: (listener: (event: unknown) => void) => () => void
  }
}
