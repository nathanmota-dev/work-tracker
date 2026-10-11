import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("desktop", {
  request: (path: string, body?: unknown): Promise<unknown> => ipcRenderer.invoke("api:request", path, body),
  connectionStatus: (): Promise<boolean> => ipcRenderer.invoke("api:status"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("app:open-external", url),
  onEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => listener(data)
    ipcRenderer.on("api:event", handler)
    return () => ipcRenderer.removeListener("api:event", handler)
  },
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
})
