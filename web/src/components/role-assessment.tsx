import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Panel } from "@/components/workspace-ui"
import { prepareSkill } from "@/lib/agent"

/** Asks the agent to assess one role, even one not saved yet, from its link or title. */
export function RoleAssessment() {
  const [role, setRole] = useState("")
  return <Panel title="Assess a role">
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (role.trim()) prepareSkill("deep-scout", { query: role.trim() }) }}>
      <p className="text-sm text-muted-foreground">Compare a specific opportunity against your experience. The agent saves it with a fit rating.</p>
      <Field label="Job link or title"><Input value={role} placeholder="https://www.linkedin.com/jobs/view/…" onChange={event => setRole(event.target.value)} /></Field>
      <Button variant="outline" disabled={!role.trim()}><Sparkles /> Assess with agent</Button>
    </form>
  </Panel>
}
