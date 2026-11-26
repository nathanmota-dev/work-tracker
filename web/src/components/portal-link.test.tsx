import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { PortalLink } from "@/components/portal-link"
import { boardAction } from "@/lib/application-board"
vi.mock("@/lib/application-board", () => ({ boardAction: vi.fn() }))

beforeEach(() => { vi.mocked(boardAction).mockReset().mockResolvedValue({} as never) })

it("explains that a LinkedIn posting is resolved and saves a pasted employer link", async () => {
  const saved = vi.fn()
  render(<PortalLink applicationId={2} url="https://www.linkedin.com/jobs/view/4493461039/" disabled={false} onSaved={saved} />)
  expect(screen.getByText(/follows its Apply button/)).toBeTruthy()
  const save = screen.getByRole("button", { name: "Save link" }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText("Application link"), { target: { value: " https://tally.so/r/QoRLkA " } })
  fireEvent.click(save)
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(boardAction).toHaveBeenCalledWith("portal-link", { id: 2, external_url: "https://tally.so/r/QoRLkA" })
})

it("shows the save error and renders nothing without an application", async () => {
  vi.mocked(boardAction).mockRejectedValue(new Error("Use an HTTP or HTTPS link"))
  const { rerender } = render(<PortalLink applicationId={2} url="https://jobs.lever.co/acme/1" disabled={false} onSaved={vi.fn()} />)
  expect(screen.getByText("The agent fills the form at this link.")).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Application link"), { target: { value: "ftp://bad" } })
  fireEvent.click(screen.getByRole("button", { name: "Save link" }))
  expect((await screen.findByRole("alert")).textContent).toContain("HTTP or HTTPS")
  rerender(<PortalLink url="https://jobs.lever.co/acme/1" disabled={false} onSaved={vi.fn()} />)
  expect(screen.queryByLabelText("Application link")).toBeNull()
})
