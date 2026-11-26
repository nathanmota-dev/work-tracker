import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { CONFIRMATION_MS, GetStarted, NextStepHint, SetupNotice } from "./get-started"
import { desktopDouble } from "@/test/doubles"
import { publish } from "@/lib/api"
import type { OnboardingStatus, OnboardingStep } from "@/lib/onboarding"

const pending = (id: OnboardingStep["id"], items: OnboardingStep["items"], optional = false): OnboardingStep => ({ id, optional, state: "pending", items })
function fresh(): OnboardingStatus {
  return {
    agentReady: true, readyAgents: ["acp/claude-code"], setupCompletedAt: "earlier",
    hidden: false, completedAt: null, complete: false, next: "resume",
    steps: [
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

const step = (name: RegExp) => screen.getByRole("button", { name })

it("renders each step from the workspace with links to the exact correction, one step open at a time", async () => {
  render(<GetStarted />)
  const view = await card()
  expect(view.getByText("0 of 4 steps complete")).toBeInTheDocument()
  // The next pending step opens by itself; the agent is connected before the workspace opens.
  expect(view.queryByText(/Connect your agent/)).not.toBeInTheDocument()
  expect(step(/^1\. Set up your base resume/)).toHaveAttribute("aria-expanded", "true")
  expect(view.getByText("• LaTeX and PDF tools: missing latexmk")).toBeInTheDocument()
  expect(view.getByRole("link", { name: "Open base resume" })).toHaveAttribute("href", "#/resume?id=base")
  expect(view.getAllByRole("button", { name: "Skip for now" })).toHaveLength(1)
  expect(view.queryByText(/Start without an agent/)).not.toBeInTheDocument()
  fireEvent.click(step(/^2\. Fill essential answers/))
  expect(view.getByText("• Email: invalid")).toBeInTheDocument()
  expect(view.getByRole("link", { name: "Add answers" })).toHaveAttribute("href", "#/profile?tab=answers&field=last_name")
  expect(view.queryByRole("link", { name: "Open base resume" })).not.toBeInTheDocument()
  fireEvent.click(step(/^3\. Run your first search/))
  expect(view.getByRole("link", { name: "Search jobs" })).toHaveAttribute("href", "#/jobs?focus=true&mode=search")
  fireEvent.click(step(/^4\. Prepare your first application/))
  expect(view.getByRole("link", { name: "Open the shortlist" })).toHaveAttribute("href", "#/jobs?view=shortlist")
  fireEvent.click(step(/^4\. Prepare your first application/))
  expect(view.queryByRole("link", { name: "Open the shortlist" })).not.toBeInTheDocument()
})

it("skips the base resume and lets it resume", async () => {
  render(<GetStarted />)
  fireEvent.click((await card()).getByRole("button", { name: "Skip for now" }))
  await waitFor(() => expect(screen.getAllByText("Skipped")).toHaveLength(1))
  expect(saved).toEqual([{ skipped: ["resume"] }])
  fireEvent.click(step(/^1\. Set up your base resume/))
  expect(screen.getByText(/Tailored resumes stay unavailable/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Resume step" }))
  await waitFor(() => expect(saved.at(-1)).toEqual({ skipped: [] }))
  expect(await screen.findByRole("link", { name: "Open base resume" })).toBeInTheDocument()
})

it("updates by itself on workspace and resume source events", async () => {
  render(<GetStarted />)
  await card()
  status.steps[0] = { ...status.steps[0]!, state: "done" }
  act(() => publish({ type: "resume-sources-changed" }))
  expect(await screen.findByText("1 of 4 steps complete")).toBeInTheDocument()
  status.steps[1] = { ...status.steps[1]!, state: "done" }
  act(() => publish({ type: "changed", table: "applicant_answers" }))
  expect(await screen.findByText("2 of 4 steps complete")).toBeInTheDocument()
  status.steps[2] = { ...status.steps[2]!, state: "done" }
  act(() => publish({ type: "changed", table: "profile_metrics" }))
  expect(screen.getByText(/^2 of 4/)).toBeInTheDocument()
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
  expect(await screen.findByText("4 of 4 steps complete")).toBeInTheDocument()
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  desktop.request.mockRejectedValueOnce(new Error("offline"))
  fireEvent.click(screen.getByRole("button", { name: "Hide checklist" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("The checklist could not be saved.")
})

it("points empty lists and blockers at the matching step only while it is unfinished", async () => {
  render(<p><NextStepHint fallback="Generic" /></p>)
  expect(await screen.findByRole("link", { name: "Set up your base resume" })).toHaveAttribute("href", "#/dashboard?step=resume")
  status.steps[0] = { ...status.steps[0]!, state: "skipped" }
  render(<SetupNotice step="resume">Generating needs a resume.</SetupNotice>)
  expect(await screen.findByText(/Generating needs a resume\. Set this up in Get started:/)).toBeInTheDocument()
  render(<SetupNotice step="resume" pendingOnly>Pending only.</SetupNotice>)
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
