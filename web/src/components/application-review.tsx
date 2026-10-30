import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Field, Panel } from "@/components/workspace-ui"
import { JobLinkDialog } from "@/components/job-link-dialog"
import { date, subscribe } from "@/lib/api"
import {
  boardAction,
  type BoardField,
  type ReviewDecision,
  type ReviewItem,
} from "@/lib/application-board"

const REASONS: Record<ReviewItem["review_reason"], string> = {
  missing_job: "No saved job",
  unknown_status: "Unclear status",
  missing_stage: "Submitted but not on the board",
  duplicate_job: "Another application exists for this job",
}
const DECISIONS: Record<ReviewDecision, string> = {
  track: "Add to board",
  mark_submitted: "It was submitted",
  mark_not_submitted: "It was not submitted",
  keep_attempt: "Keep as a separate attempt",
}
const BOARD_FIELDS: Record<BoardField, string> = {
  company_name: "Company name",
  external_url: "Job link",
  applied_at: "Application date",
}
const reviewTables = ["applications", "application_events", "jobs"]

function useReview() {
  const [items, setItems] = useState<ReviewItem[]>()
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((value) => value + 1)
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "changed" && (!event.table || reviewTables.includes(String(event.table))))
          setRevision((value) => value + 1)
      }),
    [],
  )
  useEffect(() => {
    let active = true
    boardAction("review", {})
      .then((value) => {
        if (active) { setItems(value.items); setError("") }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [revision])
  return { items, error, refresh }
}

function ReviewSummary({ item }: { item: ReviewItem }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">
          #{item.id} · {item.company_name ?? "Unknown company"} · {item.role_title ?? "Untitled role"}
        </p>
        <Badge variant="secondary">{REASONS[item.review_reason]}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Origin {item.origin} · status “{item.status}” · {item.submission_status === "submitted" ? "submitted" : "not submitted"}
        {item.applied_at ? ` · ${date(item.applied_at)}` : ""}
        {item.job_id !== null ? ` · job #${item.job_id}${item.job_exists ? "" : " (missing)"}` : ""}
      </p>
      {item.related.length > 0 && (
        <p className="text-xs text-destructive">
          Same job as {item.related.map((other) => `#${other.id} (attempt ${other.attempt ?? "?"}, ${other.submission_status.replace("_", " ")})`).join(", ")}. Records are never merged.
        </p>
      )}
      {item.candidates.length > 1 && (
        <p className="text-xs text-destructive">
          {item.candidates.length} saved jobs match this link. Choose one with “Link job”.
        </p>
      )}
    </div>
  )
}

function ReviewEntry({ item, onLink, onResolved }: {
  item: ReviewItem
  onLink: () => void
  onResolved: (message: string) => void
}) {
  const [values, setValues] = useState<Partial<Record<BoardField, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const needsData = item.missing.length > 0 && item.decisions.some((decision) => decision !== "mark_not_submitted" && decision !== "keep_attempt")
  async function decide(decision: ReviewDecision) {
    setBusy(true)
    setError("")
    try {
      const applied = values.applied_at ? new Date(values.applied_at).toISOString() : undefined
      const { item: remaining } = await boardAction("review/resolve", { id: item.id, decision, ...values, applied_at: applied })
      onResolved(remaining ? `Application #${item.id} still needs review: ${REASONS[remaining.review_reason].toLowerCase()}.` : `Application #${item.id} reconciled.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="space-y-3 rounded-lg border p-3 text-sm">
      <ReviewSummary item={item} />
      {needsData && (
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
          {item.missing.map((field) => (
            <Field key={field} label={BOARD_FIELDS[field]}>
              <Input
                aria-invalid
                type={field === "applied_at" ? "datetime-local" : field === "external_url" ? "url" : "text"}
                value={values[field] ?? ""}
                onChange={(e) => setValues((previous) => ({ ...previous, [field]: e.target.value }))}
              />
            </Field>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        {item.decisions.map((decision) => (
          <Button key={decision} size="sm" variant="outline" disabled={busy} onClick={() => void decide(decision)}>
            {DECISIONS[decision]}
          </Button>
        ))}
        {item.link_job && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onLink}>Link job</Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </li>
  )
}

/**
 * Legacy applications the journey migration could not classify, as a banner
 * that expands into a review filter. Safe fixes run only on request; every
 * other record waits for an explicit decision.
 */
export function ApplicationReview({
  open: controlled,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { items, error, refresh } = useReview()
  const [linking, setLinking] = useState<ReviewItem>()
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(false)
  const open = controlled ?? local
  const toggle = () => (onOpenChange ?? setLocal)(!open)
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!items?.length) return notice ? <p role="status" className="text-sm">{notice}</p> : null
  const safe = items.filter((item) => item.safe_fix).length
  const resolved = (message: string) => { setNotice(message); refresh() }
  async function reconcile() {
    setBusy(true)
    try {
      const { fixed } = await boardAction("review/reconcile", {})
      resolved(fixed.length ? `${fixed.length} application(s) reconciled. Their IDs and history are kept.` : "Nothing could be reconciled safely.")
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel
      title={`Needs review (${items.length})`}
      action={
        <div className="flex flex-wrap gap-2">
          {safe > 0 && (
            <Button size="sm" disabled={busy} onClick={() => void reconcile()}>
              Apply safe fixes ({safe})
            </Button>
          )}
          <Button size="sm" variant="outline" aria-expanded={open} onClick={toggle}>
            {open ? "Hide review" : "Review"}
          </Button>
        </div>
      }
    >
      <p className="text-xs text-muted-foreground">
        Older applications whose job, status or board stage could not be decided automatically.
        {!open && " Open the review to decide each one."}
      </p>
      {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
      {open && (
        <ul aria-label="Applications to review" className="mt-3 space-y-3">
          {items.map((item) => (
            <ReviewEntry key={item.id} item={item} onLink={() => setLinking(item)} onResolved={resolved} />
          ))}
        </ul>
      )}
      {linking && (
        <JobLinkDialog
          applicationId={linking.id}
          title={`Link application #${linking.id}`}
          onClose={() => setLinking(undefined)}
          onLinked={() => { setLinking(undefined); resolved(`Application #${linking.id} linked to its job.`) }}
        />
      )}
    </Panel>
  )
}
