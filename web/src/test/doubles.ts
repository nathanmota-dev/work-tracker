import { vi } from "vitest"
export function desktopDouble() {
  return {
    request: vi
      .fn<NonNullable<Window["desktop"]>["request"]>()
      .mockResolvedValue(undefined),
    readPdf: vi
      .fn<NonNullable<Window["desktop"]>["readPdf"]>()
      .mockResolvedValue(new ArrayBuffer(0)),
    savePdf: vi
      .fn<NonNullable<Window["desktop"]>["savePdf"]>()
      .mockResolvedValue(true),
    connectionStatus: vi.fn().mockResolvedValue(false),
    backendStatus: vi.fn().mockResolvedValue(undefined),
    restartBackend: vi.fn().mockResolvedValue(true),
    openExternal: vi
      .fn<NonNullable<Window["desktop"]>["openExternal"]>()
      .mockResolvedValue(undefined),
    onEvent: vi
      .fn<NonNullable<Window["desktop"]>["onEvent"]>()
      .mockReturnValue(() => {}),
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
