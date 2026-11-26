import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AgentPreferences, useAgentPreferences } from "./agent-preferences"
import { useApi, useConnection } from "@/lib/api"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  useApi: vi.fn(),
  useConnection: vi.fn(),
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
function Preferences() {
  return <AgentPreferences preferences={useAgentPreferences()} />
}
const view = () => render(<Preferences />)
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
  instance.rerender(<Preferences />)
  expect(screen.getByRole("alert")).toHaveTextContent("providers offline")
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  expect(refresh).toHaveBeenCalledOnce()
})
it("rejects stale provider or model preferences without reporting success", () => {
  localStorage.setItem("work-tracker-provider", "one")
  localStorage.setItem("work-tracker-model", "missing-model")
  view()
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an available agent, model and effort")
  expect(screen.queryByText("Preferences saved.")).not.toBeInTheDocument()
  expect(localStorage.getItem("work-tracker-model")).toBe("missing-model")
})
it("saves a preferred effort for agents that support it and rejects a stale one", () => {
  localStorage.setItem("work-tracker-provider", "two")
  localStorage.setItem("work-tracker-effort", "max")
  view()
  expect(screen.getByRole("slider", { name: "Preferred effort" })).toHaveAttribute("aria-valuetext", "Max")
  fireEvent.keyDown(screen.getByRole("slider", { name: "Preferred effort" }), { key: "ArrowLeft" })
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))
  expect(localStorage.getItem("work-tracker-effort")).toBe("low")
  fireEvent.change(screen.getByLabelText("Preferred agent"), { target: { value: "one" } })
  expect(screen.queryByRole("slider", { name: "Preferred effort" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))
  expect(localStorage.getItem("work-tracker-effort")).toBe("")
})
it("rejects an effort the preferred agent does not offer", () => {
  localStorage.setItem("work-tracker-provider", "two")
  localStorage.setItem("work-tracker-effort", "xhigh")
  view()
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }))
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an available agent, model and effort")
  expect(localStorage.getItem("work-tracker-effort")).toBe("xhigh")
})

