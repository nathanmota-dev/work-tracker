import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { FollowupsPanel } from "./followups-panel"
import { prepareSkill } from "@/lib/agent"
import type { ApplicationEvent, TrackedApplication } from "@/lib/application-board"
import type { FollowupDraft } from "@/lib/followups"
import { desktopDouble } from "@/test/doubles"

vi.mock("@/lib/agent", async (original) => ({ ...(await original<typeof import("@/lib/agent")>()), prepareSkill: vi.fn() }))

const application = { id: 5, company_name: "Acme", tracking_status: "active" } as TrackedApplication
const draft = (id: number, fields: Partial<FollowupDraft> = {}): FollowupDraft => ({
  id, application_id: 5, kind: "follow_up", channel: "linkedin", subject: null, body_md: `Body ${id}`,
  status: "draft", stage_event_id: null, created_at: "2026-11-01T12:00:00.000Z", sent_at: null, ...fields,
})
const event = (id: number, stage_category: ApplicationEvent["stage_category"], occurred_at: string, event_type: ApplicationEvent["event_type"] = "moved") =>
  ({ id, application_id: 5, event_type, from_stage_id: 1, to_stage_id: 2, stage_name: `Stage ${id}`, stage_category, occurred_at, reason: null, note: null }) as ApplicationEvent
let drafts: FollowupDraft[]
const writeText = vi.fn()
beforeEach(() => {
  drafts = [
    draft(3, { channel: "email", subject: "Backend Engineer", body_md: "Hello team" }),
    draft(2, { status: "sent", sent_at: "2026-11-05T12:00:00.000Z" }),
    draft(1, { status: "discarded", body_md: "Old discarded" }),
  ]
  window.desktop = desktopDouble()
  vi.mocked(window.desktop.request).mockImplementation(async (path: string) => {
    if (path === "followups?application_id=5") return drafts
    if (path === "followups/sent" || path === "followups/discard") return {}
    return undefined
  })
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
})
afterEach(() => {
  delete window.desktop
})
const card = async (name: RegExp) => within(await screen.findByRole("listitem", { name }))

it("lists drafts and sent messages, hides discarded ones and copies the message with its subject", async () => {
  render(<FollowupsPanel application={application} />)
  const email = await card(/Follow-up by Email/)
  expect(email.getByText("Subject: Backend Engineer")).toBeInTheDocument()
  expect(screen.queryByText("Old discarded")).not.toBeInTheDocument()
  expect(screen.getByText("1 of 2 follow-ups sent. The agent drafts; you send it yourself and mark it as sent.")).toBeInTheDocument()
  fireEvent.click(email.getByRole("button", { name: "Copy" }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("Subject: Backend Engineer\n\nHello team"))
  expect(await screen.findByRole("status")).toHaveTextContent("Copied to the clipboard.")
  const sent = await card(/Follow-up by LinkedIn/)
  expect(sent.getByText(/^Sent /)).toBeInTheDocument()
  expect(sent.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument()
  writeText.mockRejectedValueOnce(new Error("denied"))
  fireEvent.click(sent.getByRole("button", { name: "Copy" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed")
})

it("marks a draft as sent or discards it and reports API errors", async () => {
  render(<FollowupsPanel application={application} />)
  const email = await card(/Follow-up by Email/)
  fireEvent.click(email.getByRole("button", { name: "Mark as sent" }))
  await waitFor(() => expect(window.desktop!.request).toHaveBeenCalledWith("followups/sent", { id: 3 }))
  expect(await screen.findByText("Marked as sent. The quiet clock restarts today.")).toBeInTheDocument()
  fireEvent.click(email.getByRole("button", { name: "Discard" }))
  await waitFor(() => expect(window.desktop!.request).toHaveBeenCalledWith("followups/discard", { id: 3 }))
  expect(await screen.findByText("Draft discarded.")).toBeInTheDocument()
  vi.mocked(window.desktop!.request).mockRejectedValueOnce(new Error("2 follow-ups were already sent"))
  fireEvent.click(email.getByRole("button", { name: "Mark as sent" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("2 follow-ups were already sent")
})

it("drafts a follow-up or a thank-you note for the latest interview event through the agent panel", async () => {
  const events = [event(10, "recruiter", "2026-11-10T12:00:00.000Z"), event(11, "applied", "2026-11-12T12:00:00.000Z"), event(12, "technical", "2026-11-11T12:00:00.000Z", "created"), event(13, "technical", "2026-11-13T12:00:00.000Z", "archived")]
  render(<FollowupsPanel application={application} events={events} />)
  await card(/Follow-up by Email/)
  fireEvent.click(screen.getByRole("button", { name: "Draft follow-up" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("followup", { applicationId: "5", kind: "follow_up" })
  fireEvent.click(screen.getByRole("button", { name: "Draft thank-you" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("followup", { applicationId: "5", kind: "thank_you", stage: "Stage 12", stageEventId: "12" })
})

it("disables the third follow-up with an explanation, keeps thank-you notes and shows the empty state", async () => {
  drafts = [draft(2, { status: "sent" }), draft(1, { status: "sent" })]
  const { unmount } = render(<FollowupsPanel application={application} />)
  expect(await screen.findByText(/2 follow-ups already sent\. A third one is not offered/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Draft follow-up" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Draft thank-you" }))
  expect(prepareSkill).toHaveBeenLastCalledWith("followup", { applicationId: "5", kind: "thank_you" })
  unmount()
  drafts = []
  render(<FollowupsPanel application={{ ...application, tracking_status: "archived" }} />)
  expect(await screen.findByText("No drafts yet.")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Draft follow-up" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Draft thank-you" })).toBeDisabled()
})
