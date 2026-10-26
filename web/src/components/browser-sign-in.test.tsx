import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { BrowserSignIn } from "./browser-sign-in"
it("opens the browser through the backend, reports errors and allows retry", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("Finish the active run")).mockResolvedValue({ ok: true })
  window.desktop = { readPdf: vi.fn(), savePdf: vi.fn(), request, connectionStatus: async () => true, openExternal: vi.fn(), onEvent: () => () => {} }
  render(<BrowserSignIn />)
  fireEvent.click(screen.getByRole("button", { name: "Open sign-in browser" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Finish the active run")
  fireEvent.click(screen.getByRole("button", { name: "Open sign-in browser" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Complete sign-in in Chrome")
  expect(request).toHaveBeenCalledWith("browser/login", {})
})
