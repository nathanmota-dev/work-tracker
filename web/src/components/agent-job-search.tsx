import { useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, controlClass } from "@/components/workspace-ui"
import { SetupNotice } from "@/components/get-started"
import { TagField, locationSuggestions, roleSuggestions } from "@/components/tag-field"
import { SearchOutcomes } from "@/components/job-discovery"
import { dismissAgentCompletion, runAgent, useAgent } from "@/lib/agent"
import { useConnection } from "@/lib/api"
import { useDefaultAgent } from "@/lib/default-agent"
import { AgentExecution, runParams } from "@/components/agent-panel"
import { AgentRunNote, DiscoverLayout } from "@/components/discover-layout"
import { useSkillInputs } from "@/lib/skill-inputs"
import type { SearchSaveResult } from "../../../src/jobs/search-results"

let shownCompletion: number | undefined

/** The agent's job search (job-scout), run in place: the criteria on the left start it, and its conversation shows on the right. */
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
    // This screen returns to the new jobs itself, so the global "View new jobs" notice would repeat it.
    dismissAgentCompletion()
    const outcomes = agent.jobOutcomes
    setOutcomes(outcomes)
    onComplete.current(outcomes.filter(item => item.status === "saved" && !item.job?.archived_at).map(item => Number(item.job?.id)), outcomes)
  }, [agent.completion, agent.jobOutcomes])
  const role = inputs.query ?? ""
  const live = useConnection()
  const defaults = useDefaultAgent()
  const { selectedProvider, effectiveModel, effectiveEffort } = defaults
  // Every criterion is needed before the agent can start.
  const filled = !!role.trim() && !!inputs.location?.trim() && !!inputs.extra?.trim()
  const canRun = !!selectedProvider && live && !agent.running && filled
  return <DiscoverLayout title="Find jobs with your agent" output={<AgentExecution fill />}>
      <form ref={form} className="space-y-4" onSubmit={event => {
        event.preventDefault()
        if (!canRun || !selectedProvider) return
        setOutcomes([])
        void runAgent(selectedProvider.id, "job-scout", runParams({ query: role, ...(inputs.location && { location: inputs.location }), ...(inputs.extra && { extra: inputs.extra }),
          instructions: "Save discovered jobs for triage and report saved, already saved, or failed for each item." }), effectiveModel || undefined, effectiveEffort || undefined)
      }}>
        <p className="text-sm text-muted-foreground">Your agent searches LinkedIn for roles that match your profile, checks their fit and saves them to Jobs. Your criteria are kept for the next search.</p>
        <TagField label="Roles" required placeholder="Software Engineer, Full Stack…" suggestions={roleSuggestions} value={role} disabled={agent.running}
          onChange={value => setInputs({ query: value })} />
        <TagField label="Location" required placeholder="City, country or Remote" suggestions={locationSuggestions} value={inputs.location ?? ""} disabled={agent.running}
          onChange={value => setInputs({ location: value })} />
        <Field label="Additional context">
          <Textarea required className={`${controlClass} h-40 resize-y py-2`} placeholder="Seniority, languages, stack, companies to avoid…" disabled={agent.running}
            value={inputs.extra ?? ""} onChange={event => setInputs({ extra: event.target.value })} />
        </Field>
        <Button className="w-full" disabled={!canRun}><Sparkles /> {agent.running ? "Agent is running…" : "Find jobs with agent"}</Button>
        <AgentRunNote agent={defaults} live={live} />
      </form>
      <div className="mt-3"><SetupNotice step="connect" pendingOnly>Finding jobs needs your agent and the LinkedIn MCP. You can still add jobs by hand.</SetupNotice></div>
      {!!outcomes.length && <div className="mt-3"><SearchOutcomes outcomes={outcomes} /></div>}
  </DiscoverLayout>
}
