import { useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, Panel, controlClass } from "@/components/workspace-ui"
import { SetupNotice } from "@/components/get-started"
import { TagField, locationSuggestions, roleSuggestions } from "@/components/tag-field"
import { SearchOutcomes } from "@/components/job-discovery"
import { prepareSkill, useAgent } from "@/lib/agent"
import { useSkillInputs } from "@/lib/skill-inputs"
import type { SearchSaveResult } from "../../../src/jobs/search-results"

let shownCompletion: number | undefined

/** The agent's job search (job-scout): it looks for roles that match the candidate, beyond one page of results, and saves them for triage. */
export function AgentJobSearch({ onResults, focus }: { onResults: (ids: number[], outcomes: SearchSaveResult[]) => void; focus?: boolean }) {
  const agent = useAgent()
  const { inputs, setInputs } = useSkillInputs("job-scout")
  const [outcomes, setOutcomes] = useState<SearchSaveResult[]>([])
  const form = useRef<HTMLFormElement>(null)
  const onComplete = useRef(onResults)
  onComplete.current = onResults
  useEffect(() => { if (focus) form.current?.querySelector("input")?.focus() }, [focus])
  useEffect(() => {
    const completion = agent.completion
    if (!completion || completion.skill !== "job-scout" || completion.id === shownCompletion) return
    shownCompletion = completion.id
    const outcomes = agent.jobOutcomes
    setOutcomes(outcomes)
    onComplete.current(outcomes.filter(item => item.status === "saved" && !item.job?.archived_at).map(item => Number(item.job?.id)), outcomes)
  }, [agent.completion, agent.jobOutcomes])
  const role = inputs.query ?? ""
  return <Panel title="Find jobs with your agent">
    <form ref={form} className="space-y-4" onSubmit={event => {
      event.preventDefault()
      setOutcomes([])
      // Role, location and context come from the saved inputs the agent panel shows too.
      prepareSkill("job-scout", { instructions: "Save discovered jobs for triage and report saved, already saved, or failed for each item." })
    }}>
      <p className="text-sm text-muted-foreground">Your agent searches LinkedIn for roles that match your profile, checks their fit and saves them to Jobs. Your criteria are kept for the next search.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TagField label="Roles" required placeholder="Software Engineer, Full Stack…" suggestions={roleSuggestions} value={role} disabled={agent.running}
          onChange={value => setInputs({ query: value })} />
        <TagField label="Location" placeholder="City, country or Remote" suggestions={locationSuggestions} value={inputs.location ?? ""} disabled={agent.running}
          onChange={value => setInputs({ location: value })} />
      </div>
      <Field label="Additional context">
        <Textarea className={`${controlClass} h-28 resize-y py-2`} placeholder="Seniority, languages, stack, companies to avoid…" disabled={agent.running}
          value={inputs.extra ?? ""} onChange={event => setInputs({ extra: event.target.value })} />
      </Field>
      <Button disabled={agent.running || !role.trim()}><Sparkles /> Find jobs with agent</Button>
    </form>
    <div className="mt-3"><SetupNotice step="connect" pendingOnly>Finding jobs needs your agent and the LinkedIn MCP. You can still add jobs by hand.</SetupNotice></div>
    {!!outcomes.length && <div className="mt-3"><SearchOutcomes outcomes={outcomes} /></div>}
  </Panel>
}
