import { request } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
import type { ApplicationEvent } from "@/lib/application-board"
import { INTERVIEW_CATEGORIES, MAX_FOLLOW_UPS } from "../../../src/followups/types"
import type { FollowupDraft, FollowupKind } from "../../../src/followups/types"
export { MAX_FOLLOW_UPS } from "../../../src/followups/types"
export type {
  FollowupCandidates,
  FollowupChannel,
  FollowupDraft,
  FollowupKind,
  FollowUpDue,
  ThankYouDue,
} from "../../../src/followups/types"

export const CHANNEL_LABELS = { email: "Email", linkedin: "LinkedIn", portal: "Portal" } as const
export const KIND_LABELS = { follow_up: "Follow-up", thank_you: "Thank-you" } as const
export const CAP_REACHED = `${MAX_FOLLOW_UPS} follow-ups already sent`

export const followupsPath = (applicationId: number) => `followups?application_id=${applicationId}`
export const CANDIDATES_PATH = "followups/candidates"

/** Follow-ups of an application the user already marked as sent. */
export function sentCount(drafts: FollowupDraft[]) {
  return drafts.filter((draft) => draft.kind === "follow_up" && draft.status === "sent").length
}

/** The latest move into an interview stage, which a thank-you note answers. */
export function latestInterviewEvent(events: ApplicationEvent[]) {
  return events
    .filter((event) => ["created", "moved"].includes(event.event_type) && (INTERVIEW_CATEGORIES as readonly string[]).includes(event.stage_category))
    .reduce<ApplicationEvent | undefined>((latest, event) => (!latest || event.occurred_at > latest.occurred_at || (event.occurred_at === latest.occurred_at && event.id > latest.id) ? event : latest), undefined)
}

/** Opens the agent panel with the followup skill for one application; nothing runs until the user starts it. */
export function draftFollowup(applicationId: number, kind: FollowupKind, event?: { id: number; stage_name: string }) {
  prepareSkill("followup", {
    applicationId: String(applicationId),
    kind,
    ...(kind === "thank_you" && event ? { stage: event.stage_name, stageEventId: String(event.id) } : {}),
  })
}

/** The message as the user pastes it: the subject line first for an email. */
export function messageText(draft: Pick<FollowupDraft, "subject" | "body_md">) {
  return draft.subject ? `Subject: ${draft.subject}\n\n${draft.body_md}` : draft.body_md
}

export function followupAction(action: "sent" | "discard", id: number) {
  return request<FollowupDraft>(`followups/${action}`, { id })
}
