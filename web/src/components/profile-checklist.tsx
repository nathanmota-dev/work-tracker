import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** One thing the profile should have: an answer to add, or resume data to import. */
export interface ProfileCheck {
  id: string
  label: string
  hint: string
  done: boolean
  /** The answer that completes it; without one, importing a resume does. */
  answer?: string
}

/** Missing items first with their action; a count of what is already done. */
export function ProfileChecklist({ checks, onAnswer, onImport }: {
  checks: ProfileCheck[]
  onAnswer: (key: string) => void
  onImport: () => void
}) {
  const missing = checks.filter(check => !check.done)
  if (!missing.length) return null
  const done = checks.length - missing.length
  return (
    <section id="profile-missing" aria-label="What's missing" className="scroll-mt-6 rounded-2xl border p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-medium">What's missing</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{done} of {checks.length} complete</span>
      </div>
      <div aria-hidden className="mb-5 flex gap-[3px]">
        {checks.map(check => <span key={check.id} className={cn("h-1.5 flex-1 rounded-[2px]", check.done ? "bg-primary" : "bg-muted")} />)}
      </div>
      <ul className="divide-y">
        {missing.map(check => (
          <li key={check.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span aria-hidden className="size-4 shrink-0 rounded-full border-2 border-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{check.label}</p>
              <p className="text-xs text-muted-foreground">{check.hint}</p>
            </div>
            <Button size="sm" variant="outline" aria-label={`${check.answer ? "Add" : "Import"} ${check.label.toLowerCase()}`}
              onClick={() => check.answer ? onAnswer(check.answer) : onImport()}>
              {check.answer ? "Add" : "Import resume"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** "• 8 of 11 complete" under the header, the same count as the checklist, linking to the checklist; a check once complete. */
export function MissingSummary({ count, total }: { count: number; total: number }) {
  if (!count) return <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3.5 text-emerald-500" />Profile complete</p>
  return (
    <a href="#profile-missing" onClick={event => { event.preventDefault(); document.getElementById("profile-missing")?.scrollIntoView({ behavior: "smooth" }) }}
      className="inline-flex items-center gap-1.5 text-xs text-amber-700 underline-offset-4 hover:underline dark:text-amber-300">
      <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />{total - count} of {total} complete
    </a>
  )
}
