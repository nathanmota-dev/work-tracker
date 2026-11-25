import { useState } from "react"
import { CompanyResearchNote } from "@/components/company-research-note"
import { AgentSelectors, type AgentSelection } from "@/components/launch-form"
import { FormSection, FormSheet } from "@/components/form-sheet"
import { DatePicker } from "@/components/ui/date-picker"
import { SelectControl } from "@/components/ui/select-control"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, LoadState, controlClass } from "@/components/workspace-ui"
import { runAgent, type Providers } from "@/lib/agent"
import { text, type Row } from "@/lib/api"

export const PREP_SKILL = "interview-prep"
export const PREP_STAGES = ["Recruiter screen", "Technical interview", "Take-home or case", "Final round", "Offer discussion"]
type Draft = Record<"stage" | "date" | "format" | "interviewers" | "extra", string>
export type PrepStart = { applicationId?: string; stage?: string }
export type AgentChoice = AgentSelection & { providers: Providers["providers"]; loading: boolean; error: string; retry: () => void }

export const applicationLabel = (row: Row) => `${text(row.company_name)} — ${text(row.job_title)}`

/** The pack's inputs in a side panel; running it closes the panel and shows the agent's progress on the page. */
export function InterviewPrepForm({ applications, start, choice, live, onClose }: {
  applications: Row[]
  start: PrepStart
  choice: AgentChoice
  live: boolean
  onClose: () => void
}) {
  const [applicationId, setApplicationId] = useState(start.applicationId ?? String(applications[0]?.id ?? ""))
  const [draft, setDraft] = useState<Draft>({ stage: start.stage ?? PREP_STAGES[0], date: "", format: "", interviewers: "", extra: "" })
  const selected = applications.find(row => String(row.id) === applicationId) ?? applications[0]
  const set = (key: keyof Draft) => (value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  const stages = PREP_STAGES.includes(draft.stage) || !draft.stage ? PREP_STAGES : [...PREP_STAGES, draft.stage]
  function submit() {
    if (!selected || !choice.selectedProvider || !live) return
    const { extra, ...details } = draft
    void runAgent(choice.selectedProvider.id, PREP_SKILL,
      { applicationId: String(selected.id), ...details, ...(extra.trim() ? { extra } : {}) },
      choice.effectiveModel || undefined, choice.effectiveEffort || undefined)
    onClose()
  }
  return (
    <FormSheet
      title="Build a preparation pack"
      description="Likely questions, grounded answers and a consistency brief for one round."
      busy={false}
      error=""
      submitLabel="Run agent"
      canSubmit={!!selected && !!choice.selectedProvider && live}
      footer={!live && <p className="text-xs text-muted-foreground">Waiting for the live connection before starting a run.</p>}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormSection title="Interview" className="sm:grid-cols-1">
        <Field label="Application">
          <SelectControl className={controlClass} value={String(selected?.id ?? "")} onChange={e => setApplicationId(e.target.value)}>
            {applications.map(row => <option key={String(row.id)} value={String(row.id)}>{applicationLabel(row)}</option>)}
          </SelectControl>
        </Field>
        {typeof selected?.company_name === "string" && selected.company_name.trim() && <CompanyResearchNote key={selected.company_name} company={selected.company_name} />}
      </FormSection>
      <FormSection title="Round">
        <Field label="Stage">
          <SelectControl className={controlClass} value={draft.stage} onChange={e => set("stage")(e.target.value)}>
            {stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}
          </SelectControl>
        </Field>
        <Field label="Date"><DatePicker value={draft.date} onChange={set("date")} /></Field>
        <Field label="Format"><Input className={controlClass} placeholder="Phone, video, onsite" value={draft.format} onChange={e => set("format")(e.target.value)} /></Field>
        <Field label="Interviewers"><Input className={controlClass} placeholder="Names and titles, if known" value={draft.interviewers} onChange={e => set("interviewers")(e.target.value)} /></Field>
      </FormSection>
      <FormSection title="Agent" className="sm:grid-cols-1">
        <LoadState loading={choice.loading} error={choice.error} retry={choice.retry} />
        {!!choice.providers.length && <AgentSelectors {...choice} disabled={false} />}
        <Field label="Additional context">
          <Textarea className="min-h-28" placeholder="What should the agent know?" value={draft.extra} onChange={e => set("extra")(e.target.value)} />
        </Field>
      </FormSection>
    </FormSheet>
  )
}
