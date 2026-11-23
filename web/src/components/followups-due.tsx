import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Panel } from "@/components/workspace-ui"
import { date, useApi } from "@/lib/api"
import {
  CANDIDATES_PATH,
  MAX_FOLLOW_UPS,
  draftFollowup,
  type FollowupCandidates,
  type FollowUpDue,
  type ThankYouDue,
} from "@/lib/followups"

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`
const name = (item: { id: number; company_name: string | null; role_title: string | null }) =>
  [item.company_name ?? `Application #${item.id}`, item.role_title].filter(Boolean).join(" — ")

function FollowUpRow({ item, onDraft }: { item: FollowUpDue; onDraft: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium">{name(item)}</p>
        <p className="text-xs text-muted-foreground">
          {item.stage_name} · quiet for {count(item.days_quiet, "day", "days")} · {item.sent_count} of {MAX_FOLLOW_UPS} follow-ups sent
        </p>
      </div>
      <div className="flex items-center gap-2">
        {item.has_draft && <Badge variant="secondary">Draft saved</Badge>}
        <Button size="sm" aria-label={`Draft follow-up for ${name(item)}`} onClick={onDraft}>Draft follow-up</Button>
      </div>
    </li>
  )
}

function ThankYouRow({ item, onDraft }: { item: ThankYouDue; onDraft: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium">{name(item)}</p>
        <p className="text-xs text-muted-foreground">Moved to {item.stage_name} {date(item.occurred_at)}</p>
      </div>
      <Button size="sm" aria-label={`Draft thank-you for ${name(item)}`} onClick={onDraft}>Draft thank-you</Button>
    </li>
  )
}

function DueList({ data, onClose }: { data: FollowupCandidates; onClose: () => void }) {
  // The agent panel opens over this page with the task ready; nothing runs until the user starts it.
  const draft = (...args: Parameters<typeof draftFollowup>) => { draftFollowup(...args); onClose() }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Follow-ups due</DialogTitle>
          <DialogDescription>
            The agent drafts a short message from what you already sent. You send it yourself and mark it as sent in the application.
          </DialogDescription>
        </DialogHeader>
        {!!data.follow_ups.length && (
          <section aria-label="Quiet applications" className="space-y-2">
            <h3 className="text-sm font-medium">Quiet for {data.days}+ days</h3>
            <ul className="space-y-2">
              {data.follow_ups.map((item) => <FollowUpRow key={item.id} item={item} onDraft={() => draft(item.id, "follow_up")} />)}
            </ul>
          </section>
        )}
        {!!data.thank_yous.length && (
          <section aria-label="Recent interviews" className="space-y-2">
            <h3 className="text-sm font-medium">Recent interview stages</h3>
            <ul className="space-y-2">
              {data.thank_yous.map((item) => (
                <ThankYouRow key={item.stage_event_id} item={item} onDraft={() => draft(item.id, "thank_you", { id: item.stage_event_id, stage_name: item.stage_name })} />
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Banner for follow-ups and thank-you notes that are due, with a list to draft them in place. */
export function FollowupsDue() {
  const api = useApi<FollowupCandidates>(CANDIDATES_PATH)
  const [open, setOpen] = useState(false)
  const followUps = api.data?.follow_ups?.length ?? 0
  const thankYous = api.data?.thank_yous?.length ?? 0
  if (!api.data || followUps + thankYous === 0) return null
  const title = [
    followUps ? count(followUps, "follow-up due", "follow-ups due") : "",
    thankYous ? count(thankYous, "thank-you note due", "thank-you notes due") : "",
  ].filter(Boolean).join(" · ")
  return (
    <>
      <Panel title={title} action={<Button size="sm" variant="outline" aria-label="Review follow-ups due" onClick={() => setOpen(true)}>Review</Button>}>
        <p className="text-xs text-muted-foreground">
          Applications quiet for {api.data.days}+ days and interviews from the last week. Draft a short note; nothing is sent for you.
        </p>
      </Panel>
      {open && <DueList data={api.data} onClose={() => setOpen(false)} />}
    </>
  )
}
