import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/workspace-ui"
import { SetupNotice } from "@/components/get-started"
import { AgentExecution } from "@/components/agent-panel"
import { AgentRunNote, DiscoverLayout } from "@/components/discover-layout"
import { runAgent, useAgent } from "@/lib/agent"
import { useConnection } from "@/lib/api"
import { useDefaultAgent } from "@/lib/default-agent"

/** Asks the agent to assess one role, even one not saved yet, from its link or title; the run shows on the right. */
export function RoleAssessment() {
  const [role, setRole] = useState("")
  const agent = useAgent()
  const live = useConnection()
  const defaults = useDefaultAgent()
  const { selectedProvider, effectiveModel, effectiveEffort } = defaults
  const canRun = !!selectedProvider && live && !agent.running && !!role.trim()
  return <DiscoverLayout title="Assess one role" output={<AgentExecution fill skills={["deep-scout"]} />}>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault()
      if (canRun && selectedProvider) void runAgent(selectedProvider.id, "deep-scout", { query: role.trim() }, effectiveModel || undefined, effectiveEffort || undefined)
    }}>
      <p className="text-sm text-muted-foreground">Paste the link of a role you found. The agent compares it with your experience and saves it to Jobs with a fit rating.</p>
      <Field label="Job link or title"><Input value={role} disabled={agent.running} placeholder="https://www.linkedin.com/jobs/view/…" onChange={event => setRole(event.target.value)} /></Field>
      <Button className="w-full" disabled={!canRun}><Sparkles /> {agent.running ? "Agent is running…" : "Assess with agent"}</Button>
      <AgentRunNote agent={defaults} live={live} />
    </form>
    <div className="mt-3"><SetupNotice step="connect" pendingOnly>Assessing a role needs your agent and the LinkedIn MCP.</SetupNotice></div>
  </DiscoverLayout>
}
