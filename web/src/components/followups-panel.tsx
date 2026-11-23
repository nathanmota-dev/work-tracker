import { useState } from "react"
import { Check, Copy, MessageSquarePlus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LoadState } from "@/components/workspace-ui"
import { date, useApi } from "@/lib/api"
import type { ApplicationEvent, TrackedApplication } from "@/lib/application-board"
import {
  CAP_REACHED,
  CHANNEL_LABELS,
  KIND_LABELS,
  MAX_FOLLOW_UPS,
  draftFollowup,
  followupAction,
  followupsPath,
  latestInterviewEvent,
  messageText,
  sentCount,
  type FollowupDraft,
} from "@/lib/followups"

function DraftCard({ draft, busy, onCopy, onAction }: {
  draft: FollowupDraft
  busy: boolean
  onCopy: (draft: FollowupDraft) => void
  onAction: (action: "sent" | "discard", draft: FollowupDraft) => void
}) {
  const label = `${KIND_LABELS[draft.kind]} by ${CHANNEL_LABELS[draft.channel]}`
  return (
    <li aria-label={label} className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{KIND_LABELS[draft.kind]}</span>
        <Badge variant="outline">{CHANNEL_LABELS[draft.channel]}</Badge>
        <Badge variant={draft.status === "sent" ? "default" : "secondary"}>
          {draft.status === "sent" ? `Sent ${date(draft.sent_at)}` : "Draft"}
        </Badge>
      </div>
      {draft.subject && <p className="font-medium">Subject: {draft.subject}</p>}
      <p className="whitespace-pre-wrap text-muted-foreground">{draft.body_md}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onCopy(draft)}>
          <Copy className="size-4" />
          Copy
        </Button>
        {draft.status === "draft" && (
          <>
            <Button size="sm" disabled={busy} onClick={() => onAction("sent", draft)}>
              <Check className="size-4" />
              Mark as sent
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("discard", draft)}>
              <Trash2 className="size-4" />
              Discard
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

function DraftActions({ application, sent, interview }: {
  application: TrackedApplication
  sent: number
  interview?: ApplicationEvent
}) {
  const capped = sent >= MAX_FOLLOW_UPS
  const active = application.tracking_status === "active"
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!active || capped} onClick={() => draftFollowup(application.id, "follow_up")}>
          <MessageSquarePlus className="size-4" />
          Draft follow-up
        </Button>
        <Button size="sm" variant="outline" disabled={!active} onClick={() => draftFollowup(application.id, "thank_you", interview)}>
          <MessageSquarePlus className="size-4" />
          Draft thank-you
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {capped
          ? `${CAP_REACHED}. A third one is not offered; consider closing the application if it stays quiet.`
          : `${sent} of ${MAX_FOLLOW_UPS} follow-ups sent. The agent drafts; you send it yourself and mark it as sent.`}
      </p>
    </div>
  )
}

/**
 * Follow-up and thank-you drafts of one application. Nothing is sent from
 * here: the user copies a draft, sends it on their own and records it.
 */
export function FollowupsPanel({ application, events = [] }: {
  application: TrackedApplication
  events?: ApplicationEvent[]
}) {
  const api = useApi<FollowupDraft[]>(followupsPath(application.id))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const all = Array.isArray(api.data) ? api.data : []
  const drafts = all.filter((draft) => draft.status !== "discarded")
  async function copy(draft: FollowupDraft) {
    setError("")
    try {
      await navigator.clipboard.writeText(messageText(draft))
      setMessage("Copied to the clipboard.")
    } catch {
      setError("Copy failed. Select the text and copy it manually.")
    }
  }
  async function act(action: "sent" | "discard", draft: FollowupDraft) {
    setBusy(true)
    setError("")
    try {
      await followupAction(action, draft.id)
      setMessage(action === "sent" ? "Marked as sent. The quiet clock restarts today." : "Draft discarded.")
      api.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Follow-ups" className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">Follow-ups</h3>
      <DraftActions application={application} sent={sentCount(all)} interview={latestInterviewEvent(events)} />
      <LoadState loading={api.loading && !api.data} error={api.error} retry={api.refresh} />
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {api.data && !drafts.length && <p className="text-xs text-muted-foreground">No drafts yet.</p>}
      {!!drafts.length && (
        <ul className="space-y-3">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} busy={busy} onCopy={(value) => void copy(value)} onAction={(action, value) => void act(action, value)} />
          ))}
        </ul>
      )}
    </section>
  )
}
