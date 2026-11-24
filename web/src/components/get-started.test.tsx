import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { CONFIRMATION_MS, GetStarted, NextStepHint, SetupNotice } from "./get-started"
import { desktopDouble } from "@/test/doubles"
import { publish } from "@/lib/api"
import type { OnboardingStatus, OnboardingStep } from "@/lib/onboarding"

const pending = (id: OnboardingStep["id"], items: OnboardingStep["items"], optional = false): OnboardingStep => ({ id, optional, state: "pending", items })
function fresh(): OnboardingStatus {
  return {
    hidden: false, completedAt: null, complete: false, next: "connect",
    steps: [
      pending("connect", [{ key: "agent", ready: false, reason: "untested", target: "acp/claude-code" }, { key: "mcp/linkedin", ready: true, target: "mcp/linkedin" }, { key: "mcp/chrome", ready: false, reason: "missing_executable", target: "mcp/chrome" }], true),
      pending("resume", [{ key: "sources", ready: false, reason: "not_configured" }, { key: "tools", ready: false, reason: "latexmk" }], true),
      pending("answers", [{ key: "first_name", ready: true }, { key: "last_name", ready: false, reason: "missing", target: "last_name" }, { key: "email", ready: false, reason: "invalid", target: "email" }]),
      pending("search", [{ key: "jobs", ready: false }]),
      pending("apply", [{ key: "applications", ready: false }]),
    ],
  }
}
function finished(): OnboardingStatus {
  const status = fresh()
  return { ...status, complete: true, next: null, steps: status.steps.map(step => ({ ...step, state: "done", items: step.items.map(item => ({ ...item, ready: true })) })) }
}
let desktop: ReturnType<typeof desktopDouble>
let status: OnboardingStatus
let saved: unknown[]
beforeEach(() => {
  desktop = desktopDouble(); window.desktop = desktop
  status = fresh(); saved = []
  desktop.request.mockImplementation(async (path, body) => {
    if (path === "onboarding/status") return structuredClone(status)
    if (path === "onboarding/preferences") {
      saved.push(body)
      const next = body as { hidden?: boolean; skipped?: string[]; completed?: boolean }
      status = { ...status, hidden: next.hidden ?? status.hidden, completedAt: next.completed ? "now" : status.completedAt,
        steps: status.steps.map(step => step.optional && step.state !== "done" && next.skipped ? { ...step, state: next.skipped.includes(step.id) ? "skipped" : "pending" } : step) }
      return status
    }
  })
})
afterEach(() => { vi.useRealTimers() })
const card = async () => within((await screen.findByRole("heading", { name: "Get started" })).closest("[data-slot=card]") as HTMLElement)

it("renders each step from the workspace with links to the exact correction", async () => {
  render(<GetStarted />)
  const view = await card()
  expect(view.getByText("0 of 5 steps complete. Each step updates by itself when its requirement is met.")).toBeInTheDocument()
  expect(view.getByText("• Agent (Claude Code ACP): not tested yet")).toBeInTheDocument()
  expect(view.getByText("✓ LinkedIn MCP: tested")).toBeInTheDocument()
  expect(view.getByText("• Chrome MCP: executable missing")).toBeInTheDocument()
  expect(view.getByText("• LaTeX and PDF tools: missing latexmk")).toBeInTheDocument()
  expect(view.getByText("• Email: invalid")).toBeInTheDocument()
  expect(view.getByRole("link", { name: "Open integrations" })).toHaveAttribute("href", "#/settings?section=integrations&target=acp%2Fclaude-code")
  expect(view.getByRole("link", { name: "Open base resume" })).toHaveAttribute("href", "#/profile?tab=resume")
  expect(view.getByRole("link", { name: "Add answers" })).toHaveAttribute("href", "#/profile?tab=answers&field=last_name")
  expect(view.getByRole("link", { name: "Search jobs" })).toHaveAttribute("href", "#/jobs?focus=true")
  expect(view.getByRole("link", { name: "Open the shortlist" })).toHaveAttribute("href", "#/jobs?view=shortlist")
  expect(view.getAllByRole("button", { name: "Skip for now" })).toHaveLength(2)
})

it("skips the agent steps for manual tracking and lets each one resume", async () => {
  render(<GetStarted />)
  fireEvent.click((await card()).getByRole("button", { name: "Start without an agent" }))
  await waitFor(() => expect(screen.getAllByText("Skipped")).toHaveLength(2))
  expect(saved).toEqual([{ skipped: ["connect", "resume"] }])
  expect(screen.queryByRole("button", { name: "Start without an agent" })).not.toBeInTheDocument()
  fireEvent.click(screen.getAllByRole("button", { name: "Resume step" })[0]!)
  await waitFor(() => expect(saved.at(-1)).toEqual({ skipped: ["resume"] }))
  expect(await screen.findByRole("link", { name: "Open integrations" })).toBeInTheDocument()
})

it("updates by itself on workspace and resume source events", async () => {
  render(<GetStarted />)
  await card()
  status.steps[0] = { ...status.steps[0]!, state: "done" }
  act(() => publish({ type: "changed", table: "integrations" }))
  expect(await screen.findByText("1 of 5 steps complete. Each step updates by itself when its requirement is met.")).toBeInTheDocument()
  status.steps[1] = { ...status.steps[1]!, state: "done" }
  act(() => publish({ type: "resume-sources-changed" }))
  expect(await screen.findByText("2 of 5 steps complete. Each step updates by itself when its requirement is met.")).toBeInTheDocument()
  status.steps[2] = { ...status.steps[2]!, state: "done" }
  act(() => publish({ type: "changed", table: "profile_metrics" }))
  expect(screen.getByText(/^2 of 5/)).toBeInTheDocument()
})

it("hides on request and stays reachable from a step link", async () => {
  const { unmount } = render(<GetStarted />)
  fireEvent.click((await card()).getByRole("button", { name: "Hide checklist" }))
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Get started" })).not.toBeInTheDocument())
  expect(saved).toEqual([{ hidden: true }])
  unmount()
  const focused = render(<GetStarted focus="answers" />)
  expect(await screen.findByRole("heading", { name: "Get started" })).toBeInTheDocument()
  expect(document.getElementById("get-started-answers")).toHaveAttribute("aria-current", "step")
  focused.unmount()
})

it("confirms the first completion briefly, then hides itself for good", async () => {
  status = finished()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  render(<GetStarted />)
  expect(await screen.findByRole("status")).toHaveTextContent("You’re all set.")
  await waitFor(() => expect(saved).toEqual([{ completed: true, hidden: true }]))
  act(() => publish({ type: "changed", table: "onboarding_state" }))
  await act(async () => { vi.advanceTimersByTime(CONFIRMATION_MS) })
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Get started" })).not.toBeInTheDocument())
})

it("a reopened complete checklist stays until hidden and reports save failures", async () => {
  status = { ...finished(), completedAt: "earlier" }
  render(<GetStarted />)
  expect(await screen.findByText("5 of 5 steps complete. Each step updates by itself when its requirement is met.")).toBeInTheDocument()
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  desktop.request.mockRejectedValueOnce(new Error("offline"))
  fireEvent.click(screen.getByRole("button", { name: "Hide checklist" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("The checklist could not be saved.")
})

it("points empty lists and blockers at the matching step only while it is unfinished", async () => {
  status.steps[0] = { ...status.steps[0]!, state: "skipped" }
  status.next = "resume"
  render(<p><NextStepHint fallback="Generic" /></p>)
  expect(await screen.findByRole("link", { name: "Set up your base resume" })).toHaveAttribute("href", "#/dashboard?step=resume")
  render(<SetupNotice step="connect">Search needs LinkedIn.</SetupNotice>)
  expect(await screen.findByText(/Search needs LinkedIn\. Set this up in Get started:/)).toBeInTheDocument()
  render(<SetupNotice step="connect" pendingOnly>Pending only.</SetupNotice>)
  render(<NextStepHint step="search" />)
  expect(await screen.findByRole("link", { name: "Run your first search" })).toHaveAttribute("href", "#/dashboard?step=search")
  expect(screen.queryByText("Pending only.")).not.toBeInTheDocument()
})

it("falls back to generic copy when the trail is complete", async () => {
  status = finished()
  render(<p><NextStepHint fallback="Generic copy" /></p>)
  expect(await screen.findByText("Generic copy")).toBeInTheDocument()
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("onboarding/status", undefined))
})
