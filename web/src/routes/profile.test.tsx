import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ProfilePage } from "./profile"
import { useApi } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
}))
vi.mock("@/components/settings-profile", () => ({
  SettingsProfile: () => <p>Personal details child</p>,
}))
vi.mock("@/lib/agent", () => ({ prepareSkill: vi.fn() }))
vi.mock("@/components/metric-chart", () => ({
  MetricChart: ({ rows }: { rows: unknown[] }) => (
    <p>Metric rows {rows.length}</p>
  ),
}))
let records: Record<string, unknown>
let errors: Record<string, string>
const refresh = vi.fn()
beforeEach(() => {
  records = {
    profile: null,
    answers: [],
    "profile-snapshot": { hasScan: false },
    metrics: [],
  }
  errors = {}
  refresh.mockClear()
  vi.mocked(prepareSkill).mockClear()
  vi.mocked(useApi).mockImplementation((path) => ({
    data: records[path],
    error: errors[path] ?? "",
    loading: false,
    refresh,
  }))
})
it("shows empty identity/assessment and opens the profile audit", () => {
  render(<ProfilePage />)
  expect(screen.getByText("Let’s get to know you")).toBeInTheDocument()
  expect(screen.getByText("No assessment yet")).toBeInTheDocument()
  expect(screen.getByText("Personal details child")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Audit profile" }))
  expect(prepareSkill).toHaveBeenCalledWith("profile-optimizer")
})
it("prefers saved identity, retains imported details and shows scan data including zero", () => {
  records.profile = {
    name: "Imported name",
    username: "imported",
    headline: "Engineer",
    location: "Brazil",
  }
  records.answers = [
    { key: "first_name", value: "Ana" },
    { key: "last_name", value: "Silva" },
    { key: "email", value: "ana@example.com" },
    { key: "linkedin_url", value: "https://linkedin.com/in/ana/" },
  ]
  records["profile-snapshot"] = {
    hasScan: true,
    score: 0,
    searchAppearances: 0,
    profileViews: null,
    breakdown: [{ label: "Headline check", value: "Good" }],
  }
  render(<ProfilePage />)
  expect(screen.getByText("Ana Silva")).toBeInTheDocument()
  expect(screen.queryByText("Imported name")).not.toBeInTheDocument()
  expect(screen.getByText("Engineer")).toBeInTheDocument()
  expect(screen.getByText("ana@example.com")).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "LinkedIn profile" }),
  ).toBeInTheDocument()
  expect(screen.getByText("0 / 100")).toBeInTheDocument()
  expect(screen.getByText("Headline check")).toBeInTheDocument()
  expect(screen.getByText("Good")).toBeInTheDocument()
})
it("falls back to imported identity or saved answers without a scan", () => {
  records.profile = { name: "Imported", username: "imported" }
  const instance = render(<ProfilePage />)
  expect(screen.getByText("Imported")).toBeInTheDocument()
  records.profile = null
  records.answers = [{ key: "first_name", value: "Saved" }]
  instance.rerender(<ProfilePage />)
  expect(screen.getByText("Saved")).toBeInTheDocument()
  expect(screen.queryByText("Profile score")).not.toBeInTheDocument()
})
it("reports failed sections and retries without replacing them with an empty success", () => {
  errors.profile = "profile offline"
  render(<ProfilePage />)
  expect(screen.getByRole("alert")).toHaveTextContent("profile offline")
  expect(screen.queryByText("Let’s get to know you")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})
