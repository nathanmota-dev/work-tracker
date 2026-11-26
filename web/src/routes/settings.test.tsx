import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SettingsPage } from "./settings"
import { useApi, useConnection } from "@/lib/api"
import { ThemeProvider } from "@/components/theme-provider"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
  useConnection: vi.fn(),
}))
vi.mock("@/components/resume-sources", () => ({
  ResumeSources: () => <p>Resume sources child</p>,
}))
vi.mock("@/components/browser-sign-in", () => ({
  BrowserSignIn: () => <p>Sign in child</p>,
}))
vi.mock("@/components/ui/select-control", () => ({
  SelectControl: (props: React.ComponentProps<"select">) => (
    <select {...props} />
  ),
}))
const refresh = vi.fn()
const providers = {
  default: "one",
  providers: [
    { id: "one", displayName: "Agent One", models: ["model-a"] },
    { id: "two", displayName: "Agent Two", models: ["model-b"], efforts: ["low", "max"] },
  ],
}
const view = () =>
  render(
    <ThemeProvider>
      <SettingsPage />
    </ThemeProvider>,
  )
beforeEach(() => {
  localStorage.clear()
  refresh.mockClear()
  vi.mocked(useConnection).mockReturnValue(true)
  vi.mocked(useApi).mockReturnValue({
    data: providers,
    error: "",
    loading: false,
    refresh,
  })
})
afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove("light", "dark")
})
it("shows connection changes, changes theme and selects settings tabs", () => {
  const instance = view()
  expect(screen.getByText("Connected")).toBeInTheDocument()
  // Agent preferences moved to Agent › Setup.
  expect(screen.queryByText("Agent preferences")).not.toBeInTheDocument()
  vi.mocked(useConnection).mockReturnValue(false)
  instance.rerender(
    <ThemeProvider>
      <SettingsPage />
    </ThemeProvider>,
  )
  expect(screen.getByText("Disconnected")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "dark" }))
  expect(document.documentElement).toHaveClass("dark")
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Resume sources" }), {
    button: 0,
    ctrlKey: false,
  })
  expect(screen.getByText("Resume sources child")).toBeInTheDocument()
  expect(screen.queryByRole("tab", { name: "Profile" })).not.toBeInTheDocument()
})
it("opens the Updates tab", () => {
  window.location.hash = "#/settings?section=updates"
  view()
  expect(screen.getByRole("tab", { name: "Updates" })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument()
  window.location.hash = ""
})
