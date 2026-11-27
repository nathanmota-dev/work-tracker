import { useState } from "react"
import { useSubmit } from "@/components/form-dialog"
import { FormSection, FormSheet } from "@/components/form-sheet"
import { Field, controlClass } from "@/components/workspace-ui"
import { Input } from "@/components/ui/input"
import { DateTimePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { request, type Row } from "@/lib/api"

export const INTERVIEW_STAGES: [string, string][] = [
  ["recruiter", "Recruiter screen"], ["technical", "Technical"], ["hiring-manager", "Hiring manager"],
  ["take-home", "Take-home or case"], ["final", "Final round"], ["offer", "Offer discussion"],
]
export const INTERVIEW_STATUSES: [string, string][] = [
  ["scheduled", "Scheduled"], ["done", "Done"], ["closed", "Closed"], ["cancelled", "Cancelled"],
]

/** "2026-11-27T19:47" for a datetime-local input, in local time. */
function localInput(value: unknown) {
  const parsed = new Date(String(value ?? ""))
  if (!value || Number.isNaN(parsed.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

type Draft = { company: string; when: string; stage: string; status: string; notes: string }

/** Adds or edits an interview by hand; the agent's interviews use the same fields. */
export function InterviewForm({ interview, onClose, onSaved }: { interview?: Row; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({
    company: String(interview?.company ?? ""), when: localInput(interview?.scheduled_at),
    stage: String(interview?.stage ?? "technical"), status: String(interview?.status ?? "scheduled"), notes: String(interview?.notes ?? ""),
  }))
  const { busy, error, submit } = useSubmit()
  const set = (key: keyof Draft) => (value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  const stages = INTERVIEW_STAGES.some(([value]) => value === draft.stage) || !draft.stage ? INTERVIEW_STAGES : [...INTERVIEW_STAGES, [draft.stage, draft.stage] as [string, string]]
  return (
    <FormSheet
      title={interview ? "Edit interview" : "Add interview"}
      description="Keep every conversation on your calendar, with the stage and what to remember."
      busy={busy}
      error={error}
      submitLabel="Save interview"
      canSubmit={!!draft.company.trim()}
      onClose={onClose}
      onSubmit={() => void submit(async () => {
        await request(`interviews/${interview ? "update" : "create"}`, {
          ...(interview ? { id: interview.id } : {}), company: draft.company, stage: draft.stage, status: draft.status, notes: draft.notes,
          scheduled_at: draft.when ? new Date(draft.when).toISOString() : null,
        })
        onSaved()
      })}
    >
      <fieldset disabled={busy} className="space-y-6">
        <FormSection title="Conversation">
          <Field label="Company"><Input required value={draft.company} onChange={e => set("company")(e.target.value)} /></Field>
          <Field label="Date and time"><DateTimePicker label="Date and time" value={draft.when} onChange={set("when")} /></Field>
          <Field label="Stage">
            <SelectControl className={controlClass} value={draft.stage} onChange={e => set("stage")(e.target.value)}>
              {stages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectControl>
          </Field>
          <Field label="Status">
            <SelectControl className={controlClass} value={draft.status} onChange={e => set("status")(e.target.value)}>
              {INTERVIEW_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectControl>
          </Field>
        </FormSection>
        <FormSection title="Notes" className="sm:grid-cols-1">
          <Field label="What to remember"><Textarea className="min-h-32" value={draft.notes} onChange={e => set("notes")(e.target.value)} /></Field>
        </FormSection>
      </fieldset>
    </FormSheet>
  )
}
