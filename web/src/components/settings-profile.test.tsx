import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsProfile } from "@/components/settings-profile"
import {
  candidateFromAnswers,
  linkedinUsername,
  withCandidateProfile,
} from "@/lib/candidate-profile"
import type { Row } from "@/lib/api"
// Routing is outside the profile form's persistence contract.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))
const request = vi.fn()
let rows: Row[]
beforeEach(() => {
  rows = [
    { key: "first_name", value: "Ana" },
    { key: "last_name", value: "Silva" },
    { key: "email", value: "ana@example.com" },
    { key: "linkedin_url", value: "https://www.linkedin.com/in/ana-silva/" },
  ]
  request.mockReset().mockImplementation(async (path: string, body?: Row) => {
    if (path === "answers") return [...rows]
    rows = [...rows.filter((row) => row.key !== body?.key), body!]
    return { ok: true }
  })
  window.desktop = {
    request,
    readPdf: vi.fn(),
    savePdf: vi.fn(),
    connectionStatus: async () => true,
    openExternal: vi.fn(),
    onEvent: () => () => {},
  }
})
describe("saved candidate profile", () => {
  it("loads existing details, persists canonical answers and survives remount", async () => {
    const view = render(<SettingsProfile />)
    expect(await screen.findByDisplayValue("ana-silva")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Maria" },
    })
    fireEvent.change(screen.getByLabelText("LinkedIn username"), {
      target: { value: "https://www.linkedin.com/in/maria-silva/?trk=profile" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }))
    expect(await screen.findByRole("status")).toHaveTextContent("Profile saved")
    expect(request).toHaveBeenCalledWith("answer", {
      key: "full_name",
      value: "Maria Silva",
      category: "contact",
    })
    expect(request).toHaveBeenCalledWith("answer", {
      key: "linkedin_url",
      value: "https://www.linkedin.com/in/maria-silva/",
      category: "links",
    })
    view.unmount()
    render(<SettingsProfile />)
    expect(await screen.findByDisplayValue("maria-silva")).toBeInTheDocument()
    expect(screen.getByLabelText("First name")).toHaveValue("Maria")
  })
  it("preserves unsaved edits when a write fails", async () => {
    render(<SettingsProfile />)
    await screen.findByDisplayValue("ana-silva")
    request.mockImplementation(async (path: string) => {
      if (path === "answers") return rows
      throw new Error("Offline")
    })
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Unsaved" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save profile" }),
      ).toBeEnabled(),
    )
    expect(screen.getByLabelText("First name")).toHaveValue("Unsaved")
  })
  it("rejects invalid LinkedIn URLs before any writes", async () => {
    render(<SettingsProfile />)
    await screen.findByDisplayValue("ana-silva")
    fireEvent.change(screen.getByLabelText("LinkedIn username"), {
      target: { value: "https://example.com/in/person" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "LinkedIn username",
    )
    expect(request.mock.calls.some(([path]) => path === "answer")).toBe(false)
  })
  it("reuses saved details for skills, preserving explicit overrides and context", () => {
    const profile = candidateFromAnswers(rows)
    expect(
      withCandidateProfile(profile, "profile-optimizer", {}),
    ).toMatchObject({ username: "ana-silva", displayName: "Ana Silva" })
    const params = withCandidateProfile(profile, "resume-tailor", {
      username: "other",
      extra: "Keep it concise",
    })
    expect(params.username).toBe("other")
    expect(params.extra).toContain("ana@example.com")
    expect(params.extra).toContain("Keep it concise")
    expect(linkedinUsername("@ana-silva")).toBe("ana-silva")
    expect(linkedinUsername("")).toBe("")
  })
})
