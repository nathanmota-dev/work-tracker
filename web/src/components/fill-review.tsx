import { Button } from "@/components/ui/button"
import { Panel, ExternalLink } from "@/components/workspace-ui"
import { answerCorrectionHref, useReviewedFields, type FillChecklistItem, type FillReview } from "@/lib/fill-review"
import type { PreparationRun } from "@/lib/preparation"

const itemId = (item: FillChecklistItem, index: number) => `${index}:${item.label}`
function correctionLabel(item: FillChecklistItem) {
  return item.result === "filled" || item.reason === "invalid-answer" ? `Correct answer for ${item.label}` : `Add answer for ${item.label}`
}
const isDraft = (item: FillChecklistItem) => item.result === "pending" && !!item.answer
function ItemDetail({ item }: { item: FillChecklistItem }) {
  if (item.result === "filled") return <>Answer used: {item.answer || "(empty)"}</>
  if (!isDraft(item)) return <>{item.reasonText}</>
  return <>
    <span className="block whitespace-pre-wrap text-foreground">{item.answer}</span>
    <span className="mt-1 block">{item.reasonText}</span>
    {!!item.evidence?.length && <span className="mt-1 block text-xs">Based on: {item.evidence.map(quote => `“${quote}”`).join(" · ")}</span>}
  </>
}
function staleNotice(run?: PreparationRun) {
  if (run?.phase !== "filling" || run.status === "completed") return ""
  return run.status === "running" ? "A new portal fill is running. This is the previous recorded result."
    : "The latest portal fill did not finish. This is the previous recorded result; nothing new was filled or submitted."
}

/**
 * The application's last fill result as a checklist: each field with the answer
 * used, the AI draft to review or why it is pending, plus the portal and PDF used. Completing the
 * checklist is distinct from the candidate's submission confirmation.
 */
export function FillReviewPanel({ review, run, fillBlocked, onFillAgain }: { review: FillReview; run?: PreparationRun; fillBlocked: boolean; onFillAgain: () => void }) {
  const { reviewed, toggle } = useReviewedFields(`${review.applicationId}:${review.runId ?? ""}:${review.document?.usedAt ?? ""}`)
  const pending = review.items.map((item, index) => ({ item, id: itemId(item, index) })).filter(entry => entry.item.result === "pending")
  const remaining = pending.filter(entry => !reviewed.has(entry.id)).length
  const stale = staleNotice(run)
  const drafts = pending.filter(entry => isDraft(entry.item)).length
  const progress = review.submitted ? `Marked as submitted${review.submittedAt ? ` on ${new Date(review.submittedAt).toLocaleDateString()}` : ""}.`
    : remaining ? `${remaining} pending field${remaining === 1 ? "" : "s"} to complete in the portal.`
      : "Checklist complete. The application is not submitted yet: submit it in the portal, then choose I submitted in the browser."
  return <div id="fill-review"><Panel title="Portal fill review">
    <p className="text-sm">{review.portalLabel} · {review.filled} filled · {review.pending} pending{drafts ? ` · ${drafts} AI draft${drafts === 1 ? "" : "s"} to review` : ""}</p>
    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs"><ExternalLink value={review.reviewUrl} label="Open the portal to review" /></div>
    <p className="mt-1 break-all text-xs text-muted-foreground">{review.document ? `PDF version ${review.document.versionId.slice(0, 8)} used on ${new Date(review.document.usedAt).toLocaleString()} · SHA-256 ${review.document.pdfHash}` : "The PDF version used was not recorded for this fill."}</p>
    {stale && <p role="status" className="mt-2 text-sm text-destructive">{stale}</p>}
    <ul aria-label="Fill checklist" className="my-3 divide-y rounded-lg border text-sm">{review.items.map((item, index) => {
      const id = itemId(item, index)
      return <li key={id} className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3">
        {item.result === "filled" ? <span className="text-xs font-medium text-green-700 dark:text-green-400">Filled</span>
          : <label className="flex items-center gap-1 text-xs font-medium"><input type="checkbox" aria-label={isDraft(item) ? `Reviewed AI draft for ${item.label}` : `Completed ${item.label} in the portal`} checked={reviewed.has(id)} disabled={review.submitted} onChange={event => toggle(id, event.target.checked)} />{isDraft(item) ? "AI draft" : "Pending"}</label>}
        <span className="font-medium">{item.label}</span>
        <span className="min-w-0 flex-1 break-words text-muted-foreground"><ItemDetail item={item} /></span>
        {item.correctionKey && !review.submitted && <a className="text-xs underline" href={answerCorrectionHref(item.correctionKey)}>{correctionLabel(item)}</a>}
      </li>
    })}</ul>
    {!review.submitted && pending.some(entry => entry.item.correctionKey) && <div className="mb-3 space-y-2 text-sm"><p>After correcting answers, fill again. The approved PDF is reused; the resume is not regenerated.</p><Button size="sm" variant="outline" disabled={fillBlocked} onClick={onFillAgain}>Fill again with the approved PDF</Button></div>}
    <p role="status" className="text-sm font-medium">{progress}</p>
    <p className="mt-1 text-xs text-muted-foreground">{review.instruction}</p>
  </Panel></div>
}
