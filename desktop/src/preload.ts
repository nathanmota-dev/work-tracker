import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("desktop", {
  request: (path: string, body?: unknown): Promise<unknown> => ipcRenderer.invoke("api:request", path, body),
  connectionStatus: (): Promise<boolean> => ipcRenderer.invoke("api:status"),
  backendStatus: (): Promise<unknown> => ipcRenderer.invoke("backend:status"),
  restartBackend: (): Promise<boolean> => ipcRenderer.invoke("backend:restart"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("app:open-external", url),
  onEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => listener(data)
    ipcRenderer.on("api:event", handler)
    return () => ipcRenderer.removeListener("api:event", handler)
  },
  readPdf: (id: string): Promise<ArrayBuffer> => ipcRenderer.invoke("api:pdf", id),
  savePdf: (id: string): Promise<boolean> => ipcRenderer.invoke("api:save-pdf", id),
  chooseSource: (kind: "folder" | "data"): Promise<string | null> => ipcRenderer.invoke("app:choose-source", kind),
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
})
