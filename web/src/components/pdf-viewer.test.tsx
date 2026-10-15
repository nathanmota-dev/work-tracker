import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { ComponentProps } from "react"
import { PdfViewer } from "./pdf-viewer"
import { deferred, desktopDouble } from "@/test/doubles"
const pdfMock = vi.hoisted(() => ({ document: vi.fn(), page: vi.fn() }))
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: (props: Record<string, unknown>) => {
    pdfMock.document(props)
    return (
      <div data-testid="pdf-document">{props.children as React.ReactNode}</div>
    )
  },
  Page: (props: Record<string, unknown>) => {
    pdfMock.page(props)
    return (
      <div>
        PDF page {String(props.pageNumber)} width {String(props.width)}
      </div>
    )
  },
}))
let desktop: ReturnType<typeof desktopDouble>
let resized: ResizeObserverCallback
const disconnect = vi.fn()
const artifact = {
  id: "p",
  kind: "base" as const,
  pages: 2,
  warnings: ["Review layout"],
}
beforeEach(() => {
  desktop = desktopDouble()
  window.desktop = desktop
  pdfMock.document.mockClear()
  pdfMock.page.mockClear()
  disconnect.mockClear()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
})
afterEach(() => {
  delete window.desktop
  vi.unstubAllGlobals()
})
const view = (props: Partial<ComponentProps<typeof PdfViewer>> = {}) =>
  render(<PdfViewer title="Resume" artifact={artifact} {...props} />)
it("shows an empty state without reading a PDF", () => {
  view({ artifact: null })
  expect(screen.getByText("No PDF yet")).toBeInTheDocument()
  expect(desktop.readPdf).not.toHaveBeenCalled()
})
it("loads bytes, pages and warnings and bounds navigation", async () => {
  const pending = deferred<ArrayBuffer>()
  desktop.readPdf.mockReturnValue(pending.promise)
  view()
  expect(screen.getByRole("status")).toHaveTextContent("Loading PDF")
  await act(async () => pending.resolve(new Uint8Array([37, 80]).buffer))
  expect(pdfMock.document.mock.lastCall?.[0].file.data).toEqual(
    new Uint8Array([37, 80]),
  )
  expect(screen.getByText("Review layout")).toBeInTheDocument()
  act(() => pdfMock.document.mock.lastCall?.[0].onLoadSuccess({ numPages: 3 }))
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getByText("3 / 3")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Previous" }))
  expect(screen.getByText("2 / 3")).toBeInTheDocument()
})
it("discards stale reads and resets pages when the artifact changes", async () => {
  const old = deferred<ArrayBuffer>()
  desktop.readPdf.mockReturnValueOnce(old.promise)
  const instance = view()
  instance.rerender(
    <PdfViewer
      title="Resume"
      artifact={{ ...artifact, id: "new", pages: 1 }}
    />,
  )
  await waitFor(() => expect(pdfMock.document).toHaveBeenCalled())
  await act(async () => old.resolve(new Uint8Array([99]).buffer))
  expect(pdfMock.document.mock.lastCall?.[0].file.data).toEqual(
    new Uint8Array(),
  )
  expect(screen.getByText("1 / 1")).toBeInTheDocument()
})
it("bounds zoom, fits width and disconnects the observer", async () => {
  const instance = view()
  await waitFor(() => expect(pdfMock.page).toHaveBeenCalled())
  act(() =>
    resized(
      [{ contentRect: { width: 500 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ),
  )
  for (let i = 0; i < 30; i++)
    fireEvent.click(screen.getByRole("button", { name: "Zoom in Resume" }))
  expect(pdfMock.page.mock.lastCall?.[0].width).toBe(960)
  for (let i = 0; i < 30; i++)
    fireEvent.click(screen.getByRole("button", { name: "Zoom out Resume" }))
  expect(pdfMock.page.mock.lastCall?.[0].width).toBe(240)
  fireEvent.click(screen.getByRole("button", { name: "Fit width" }))
  expect(pdfMock.page.mock.lastCall?.[0].width).toBe(480)
  instance.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})
it("reports read/load/render/download failures and downloads the selected artifact", async () => {
  desktop.readPdf.mockRejectedValueOnce(new Error("read failed"))
  const instance = view()
  expect(await screen.findByRole("alert")).toHaveTextContent("read failed")
  instance.rerender(
    <PdfViewer title="Resume" artifact={{ ...artifact, id: "next" }} />,
  )
  await waitFor(() => expect(pdfMock.document).toHaveBeenCalled())
  act(() =>
    pdfMock.document.mock.lastCall?.[0].onLoadError(new Error("load failed")),
  )
  expect(screen.getByRole("alert")).toHaveTextContent("load failed")
  act(() =>
    pdfMock.page.mock.lastCall?.[0].onRenderError(new Error("render failed")),
  )
  expect(screen.getByRole("alert")).toHaveTextContent("render failed")
  fireEvent.click(screen.getByRole("button", { name: "Download Resume" }))
  expect(desktop.savePdf).toHaveBeenCalledWith("next")
  desktop.savePdf.mockRejectedValueOnce(new Error("save failed"))
  fireEvent.click(screen.getByRole("button", { name: "Download Resume" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("save failed")
})
