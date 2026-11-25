import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ProfileOverview } from "./profile-overview"
import { useApi, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
import { resetProfileSync } from "@/lib/profile-details"
import { desktopDouble } from "@/test/doubles"
import type { ProfileSourcesState, ResumeEntry } from "../../../src/profile/types"

vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), useApi: vi.fn() }))
vi.mock("@/lib/agent", async (original) => ({ ...(await original<typeof import("@/lib/agent")>()), prepareSkill: vi.fn() }))
vi.mock("@/components/profile-sources", () => ({ ProfileSources: () => <p>Profile sources panel</p> }))

const entry = (fields: Partial<ResumeEntry>): ResumeEntry => ({ title: "", organization: "", start: "", end: "", location: "", bullets: [], skills: [], source: "both", ...fields })
const answer = (key: string, value: string, autofill_source: string | null = null): Row => ({ key, value, language: "default", category: "contact", autofill_source })
let answers: Row[]
let sources: ProfileSourcesState
const refresh = vi.fn()
beforeEach(() => {
  resetProfileSync()
  window.desktop = desktopDouble()
  answers = [
    answer("full_name", "Taylor Example", "linkedin"), answer("email", "taylor@example.test"), answer("phone", "+55 11 99999-0000"),
    answer("location", "São Paulo"), answer("linkedin_url", "https://www.linkedin.com/in/taylor/"), answer("desired_role", "Front-End, Full Stack"),
    { ...answer("summary", "Builds web apps."), language: "pt-BR" },
  ]
  sources = {
    profileDir: "/profile", dataFile: "", assets: [], linkedin: null, conflicts: [], personal: [], warnings: [],
    about: { headline: "Software Engineer", summary: "From LinkedIn.", currentCompany: "", skills: ["React", "Angular", "Go"], languages: [{ name: "English", level: "Professional" }], certifications: ["AWS Cloud Practitioner"] },
    resume: {
      experience: [
        entry({ title: "Developer", organization: "Northwind", start: "2025-07", end: "Present", bullets: ["Shipped features", "Reviewed code", "Mentored", "Deployed"], skills: ["Angular"] }),
        entry({ title: "Intern", organization: "Contoso", start: "2023", end: "2024" }),
        entry({ title: "Assistant", organization: "Fabrikam", start: "2020-01", end: "2021-02" }),
        entry({ organization: "Freelance", start: "2019-01", end: "" }),
      ],
      education: [entry({ title: "BSc Information Systems", organization: "State University", start: "2019-08", end: "2025-08" })],
    },
  }
  vi.mocked(useApi).mockImplementation(((path: string) => ({
    data: path === "answers/variants" ? answers : path === "profile-sources" ? sources : path === "resume-variants" ? [{ id: "v1" }, { id: "v2" }] : path === "applications" ? [{ id: 1 }] : [],
    loading: false, error: "", refresh,
  })) as typeof useApi)
  vi.mocked(prepareSkill).mockClear()
})

it("reads the profile like a resume: identity, counts, roles, about, timeline and chips", async () => {
  render(<ProfileOverview />)
  expect(screen.getByRole("heading", { level: 2, name: "Taylor Example" })).toBeInTheDocument()
  expect(screen.getByText("Software Engineer")).toBeInTheDocument()
  expect(screen.getAllByText("taylor@example.test").length).toBeGreaterThan(1)
  fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }))
  await waitFor(() => expect(window.desktop!.openExternal).toHaveBeenCalledWith("https://www.linkedin.com/in/taylor/"))
  expect(screen.queryByRole("button", { name: "GitHub" })).not.toBeInTheDocument()
  expect(within(screen.getByRole("list", { name: "Roles of interest" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Front-End", "Full Stack"])
  expect(screen.getByText("From LinkedIn.")).toBeInTheDocument()
  const timeline = screen.getByRole("list", { name: "Experience" })
  expect(within(timeline).getAllByRole("listitem").filter(item => item.parentElement === timeline)).toHaveLength(3)
  expect(within(timeline).getByText("Jul 2025 — Present")).toBeInTheDocument()
  expect(within(timeline).getByText("2023 — 2024")).toBeInTheDocument()
  fireEvent.click(within(timeline).getByRole("button", { name: /Read more/ }))
  expect(within(timeline).getByRole("button", { name: /Read less/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Show all (4)" }))
  expect(screen.getByText("Freelance")).toBeInTheDocument()
  expect(screen.getByText("Jan 2019")).toBeInTheDocument()
  expect(screen.getByRole("list", { name: "Skills" })).toHaveTextContent("ReactAngularGo")
  expect(screen.getByRole("list", { name: "Languages" })).toHaveTextContent("English · Professional")
  expect(screen.getByRole("list", { name: "Certifications" })).toHaveTextContent("AWS Cloud Practitioner")
  expect(screen.getByText(/From LinkedIn\. Your own edits are never replaced/)).toBeInTheDocument()
  await waitFor(() => expect(window.desktop!.request).toHaveBeenCalledWith("profile-sources/import", {}))
})

it("lists what is missing and completes it with an answer or an import", async () => {
  answers = [answer("full_name", "Taylor Example")]
  sources = { ...sources, about: null, resume: { experience: [], education: [] } }
  render(<ProfileOverview />)
  const checklist = within(screen.getByRole("region", { name: "What's missing" }))
  expect(checklist.getByText("1 of 11 complete")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "1 of 11 complete" })).toBeInTheDocument()
  fireEvent.click(checklist.getByRole("button", { name: "Add phone" }))
  expect(screen.getByLabelText("Phone")).toHaveValue("")
  expect(screen.getByLabelText("Full name")).toHaveValue("Taylor Example")
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(screen.queryByLabelText("Phone")).not.toBeInTheDocument()
  fireEvent.click(checklist.getByRole("button", { name: "Import experience" }))
  expect(await screen.findByText("Profile sources panel")).toBeInTheDocument()
  expect(screen.getByRole("dialog", { name: "Resume files" })).toBeInTheDocument()
  expect(screen.getByText("No experience yet. Import your LinkedIn PDF or resume data.")).toBeInTheDocument()
})

it("edits sections in place: one at a time, validated, saving only what changed", async () => {
  window.desktop!.request = vi.fn().mockResolvedValue({ ok: true })
  render(<ProfileOverview />)
  expect(screen.getByText("Profile complete")).toBeInTheDocument()
  expect(screen.getByRole("list", { name: "Education" })).toHaveTextContent("Aug 2019 — Aug 2025")
  fireEvent.click(screen.getByRole("button", { name: "Edit summary" }))
  expect(screen.getByLabelText("Professional summary")).toHaveValue("From LinkedIn.")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Edit Email" }))
  expect(screen.queryByLabelText("Professional summary")).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "invalid" } })
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email")
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } })
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  await waitFor(() => expect(window.desktop!.request).toHaveBeenCalledWith("answer", { key: "email", value: "new@example.test", category: "contact", language: "default" }))
  expect(window.desktop!.request).toHaveBeenCalledWith("answer/delete", { key: "phone", language: "default" })
  expect(window.desktop!.request).not.toHaveBeenCalledWith("answer", expect.objectContaining({ key: "full_name" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.")
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Edit languages" }))
  expect(screen.getByRole("button", { name: "Remove English · Professional" })).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole("button", { name: "Save changes" }), { key: "Escape" })
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Update experiences" }))
  expect(prepareSkill).toHaveBeenCalledWith("experience-bank")
})

it("keeps a section open with the error when saving fails", async () => {
  window.desktop!.request = vi.fn(async (path: string) => { if (path === "answer") throw new Error("Could not save"); return { ok: true } }) as never
  render(<ProfileOverview />)
  fireEvent.click(screen.getByRole("button", { name: "Edit roles of interest" }))
  fireEvent.click(screen.getByRole("button", { name: "Remove Front-End" }))
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save")
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
})
