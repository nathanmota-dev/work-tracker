import { useState } from "react"
import { request, useApi } from "@/lib/api"
import { permissionDecision, type PermissionSnapshot, type ToolRule } from "@/lib/permissions"
import { useSubmit } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/ui/select-control"
import { Panel, LoadState, Field, controlClass } from "@/components/workspace-ui"

export function PermissionSettings() {
  const api = useApi<PermissionSnapshot>("acp/permissions")
  const [provider, setProvider] = useState("opencode")
  const [tool, setTool] = useState("")
  const action = useSubmit()
  function rule(value: ToolRule & { sessionId?: string }, enabled: boolean) {
    void action.submit(async () => { await request("acp/permissions/rule", { ...value, enabled }); api.refresh(); if (enabled) setTool("") })
  }
  return <Panel title="Agent tool permissions">
    <p className="mb-4 text-sm text-muted-foreground">Remember exact read-only tools for one agent. Commands, clicks and sending applications always need a separate decision. Revoke a rule to ask again.</p>
    <LoadState {...api} retry={api.refresh} />
    {action.error && <p role="alert">{action.error}</p>}
    {api.data && <div className="space-y-4">
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); rule({ provider, tool }, true) }}>
        <Field label="Allowlist agent"><SelectControl className={controlClass} value={provider} onChange={e => setProvider(e.target.value)}><option value="opencode">OpenCode</option><option value="claude-code">Claude Code</option></SelectControl></Field>
        <Field label="Exact read-only tool name"><input className={controlClass} required value={tool} onChange={e => setTool(e.target.value)} placeholder="linkedin_get_person_profile" /></Field>
        <Button size="sm" disabled={action.busy}>Add tool rule</Button>
      </form>
      <ul className="space-y-2">{[...api.data.rules, ...api.data.sessionRules].map((value, index) => <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 break-all">{value.provider} · {value.tool} · {"sessionId" in value ? "This session" : "Allowlist"}</span>
        <Button size="sm" variant="outline" disabled={action.busy} onClick={() => rule(value, false)} aria-label={`Revoke ${value.tool}`}>Revoke</Button>
      </li>)}</ul>
      {!api.data.rules.length && !api.data.sessionRules.length && <p className="text-sm">No remembered tools.</p>}
      <details><summary className="cursor-pointer text-sm font-medium">Permission history</summary>
        <ul className="mt-3 space-y-3 text-sm">{api.data.history.map(item => <li key={item.id} className="break-words"><p>{item.status === "pending" ? `${item.title}: Waiting for decision` : permissionDecision(item)}</p><p className="text-xs text-muted-foreground">{item.decidedAt ?? item.createdAt} · {item.provider} · Run {item.runId}</p></li>)}</ul>
        {!api.data.history.length && <p className="text-sm">No permission decisions yet.</p>}
      </details>
    </div>}
  </Panel>
}
