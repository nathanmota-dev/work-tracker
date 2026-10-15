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
vi.mock("@/components/settings-profile", () => ({
  SettingsProfile: () => <p>Profile child</p>,
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
    { id: "two", displayName: "Agent Two", models: ["model-b"] },
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
it("loads preferences and clears the model when changing agents", () => {
  localStorage.setItem("work-tracker-provider", "one")
  localStorage.setItem("work-tracker-model", "model-a")
  view()
  expect(screen.getByLabelText("Preferred agent")).toHaveValue("one")
  expect(screen.getByLabelText("Preferred model")).toHaveValue("model-a")
  fireEvent.change(screen.getByLabelText("Preferred agent"), {
    target: { value: "two" },
  })
  expect(screen.getByLabelText("Preferred model")).toHaveValue("")
  expect(
    screen.queryByRole("option", { name: "model-a" }),
  ).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Preferred model"), {
    target: { value: "model-b" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))
  expect(localStorage.getItem("work-tracker-provider")).toBe("two")
  expect(localStorage.getItem("work-tracker-model")).toBe("model-b")
  expect(screen.getByRole("status")).toHaveTextContent("Preferences saved")
})
it("shows connection changes, changes theme and selects settings tabs", () => {
  const instance = view()
  expect(screen.getByText("Connected")).toBeInTheDocument()
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
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Profile" }), {
    button: 0,
    ctrlKey: false,
  })
  expect(screen.getByText("Profile child")).toBeInTheDocument()
})
it("shows loading/error and retries provider discovery", () => {
  vi.mocked(useApi).mockReturnValue({
    data: undefined,
    loading: true,
    error: "",
    refresh,
  })
  const instance = view()
  expect(screen.getByRole("status")).toHaveAccessibleName("Loading workspace")
  vi.mocked(useApi).mockReturnValue({
    data: undefined,
    loading: false,
    error: "providers offline",
    refresh,
  })
  instance.rerender(
    <ThemeProvider>
      <SettingsPage />
    </ThemeProvider>,
  )
  expect(screen.getByRole("alert")).toHaveTextContent("providers offline")
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})
