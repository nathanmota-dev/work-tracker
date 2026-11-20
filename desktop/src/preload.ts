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
  updates: {
    getState: () => ipcRenderer.invoke("updates:get-state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onState: (callback: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
      ipcRenderer.on("updates:state", handler)
      return () => ipcRenderer.removeListener("updates:state", handler)
    },
  },
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
})
