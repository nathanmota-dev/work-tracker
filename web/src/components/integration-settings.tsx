import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { Field, LoadState, Panel, controlClass } from "@/components/workspace-ui"
import { publish, request, useApi } from "@/lib/api"
import { integrationLabels, useIntegrations, type IntegrationEntry, type IntegrationSettings, type McpInstall, type Target } from "@/lib/integrations"

/** What the app did to install the selected MCP, with a retry when it failed. */
function InstallStatus({ install, retry }: { install?: McpInstall; retry: () => void }) {
  if (!install || install.state === "pending") return null
  return <p className="flex flex-wrap items-center gap-2 text-sm" role={install.state === "failed" ? "alert" : "status"}>
    <span>Installation: {install.message}</span>
    {install.state === "failed" && <Button type="button" size="sm" variant="outline" onClick={retry}>Try again</Button>}
  </p>
}
/** The targets a scope shows; a link's target wins, then the preferred agent, then the first one. */
function initialTarget(scope: "acp" | "mcp", options: Target[]): Target {
  const linked = new URLSearchParams(window.location.hash.split("?")[1]).get("target") as Target
  const preferred = scope === "acp" ? `acp/${localStorage.getItem("work-tracker-provider") || "opencode"}` as Target : undefined
  return [linked, preferred].find(target => target && options.includes(target)) ?? options[0]
}

/** ACP agents (Agent › Setup) or MCP servers (Settings › Integrations): command, environment and a connection test. */
export function IntegrationSettingsPanel({ scope }: { scope: "acp" | "mcp" }) {
  const api = useApi<IntegrationSettings>("integrations")
  const status = useIntegrations()
  const options = (Object.keys(integrationLabels) as Target[]).filter(target => target.startsWith(`${scope}/`))
  const [target, setTarget] = useState<Target>(() => initialTarget(scope, options))
  const [draft, setDraft] = useState<IntegrationEntry>()
  const [args, setArgs] = useState("")
  const [env, setEnv] = useState("")
  const [model, setModel] = useState("")
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const entry = api.data?.entries.find(entry => entry.target === target)
  useEffect(() => {
    if (entry && !dirty) { setDraft(entry); setArgs(JSON.stringify(entry.args, null, 2)); setEnv(JSON.stringify(entry.env, null, 2)) }
  }, [entry, dirty])
  const diagnostic = status.data?.entries.find(entry => entry.target === target)
  async function save() {
    setError(""); setNotice(""); setSaving(true)
    try {
      let parsedArgs: unknown, parsedEnv: unknown
      try { parsedArgs = JSON.parse(args); parsedEnv = JSON.parse(env) }
      catch { setError("Enter valid JSON for arguments and environment."); return }
      await request("integrations", { ...draft, args: parsedArgs, env: parsedEnv, revision: api.data?.revision })
      setDirty(false); api.refresh(); status.refresh(); publish({ type: "changed", table: "integrations" }); setNotice("Integration saved. Test the saved configuration below.")
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      const validation = ["Enter an executable name or path, with arguments in the arguments field.", "Arguments must be a JSON array of strings without null characters.", "Remove Chrome profile flags; Work Tracker manages its browser profile.", "Environment keys must be variable names and values must be strings without null characters.", "Keep stored argument placeholders in their original positions, or replace them.", "Enter a value for the new environment variable.", "OPENCODE_CONFIG_CONTENT must be a JSON object.", "Settings changed. Reload before saving your edits.", "Finish or cancel the active execution or diagnostic first."].find(safe => message.endsWith(safe))
      setError(`${validation ?? "The integration could not be saved. Check the fields and reload settings if another change was made."} Your edits are preserved.`)
    }
    finally { setSaving(false) }
  }
  return <Panel title={scope === "acp" ? "Agent connection" : "Integrations"}>
    <p className="mb-4 text-sm text-muted-foreground">{scope === "acp"
      ? "Work Tracker runs opencode or Claude Code through ACP. Install the agent yourself, adjust its command only if needed, and test it before running skills. Stored arguments and environment values are hidden; keep their placeholders to preserve them or enter replacements."
      : "Work Tracker installs the LinkedIn and Chrome MCP servers it needs; configure a command here only to use your own. Stored arguments and environment values are hidden; keep their placeholders to preserve them or enter replacements."}</p>
    <LoadState {...api} retry={api.refresh} />
    {api.data && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
      <Field label={scope === "acp" ? "Agent" : "Integration"}><SelectControl className={controlClass} value={target} disabled={saving || status.testing || dirty} onChange={event => { setTarget(event.target.value as Target); setNotice(""); setError(""); setModel("") }}>{options.map(id => <option key={id} value={id}>{integrationLabels[id]}</option>)}</SelectControl></Field>
      {draft && <>
        <Field label="Executable command"><Input required value={draft.command} disabled={saving || status.testing} onChange={event => { setDraft({ ...draft, command: event.target.value }); setDirty(true); setNotice("") }} /></Field>
        <Field label="Arguments (JSON array)"><Textarea className="min-h-40 font-mono text-xs" value={args} disabled={saving || status.testing} onChange={event => { setArgs(event.target.value); setDirty(true); setNotice("") }} /></Field>
        <Field label="Environment (JSON object)"><Textarea className="min-h-40 font-mono text-xs" value={env} spellCheck={false} disabled={saving || status.testing} onChange={event => { setEnv(event.target.value); setDirty(true); setNotice("") }} /></Field>
        <div className="flex gap-2"><Button disabled={!dirty || saving || status.testing}>Save integration</Button><Button type="button" variant="outline" disabled={saving || status.testing} onClick={() => { setDirty(false); api.refresh(); setNotice(""); setError("") }}>Reload settings</Button></div>
      </>}
      {target.startsWith("acp/") && <Field label="Model to test (empty uses provider default)"><Input value={model} onChange={event => setModel(event.target.value)} /></Field>}
      <Button type="button" variant="outline" disabled={dirty || saving || status.testing} onClick={() => { setNotice(""); void status.test([target], model) }}>{status.testing ? scope === "acp" ? "Testing agent…" : "Testing integration…" : scope === "acp" ? "Test agent" : "Test saved integration"}</Button>
      <p className="text-sm">Executable: {diagnostic ? diagnostic.executable ? "available" : "missing" : "checking"}</p>
      {target.startsWith("mcp/") && <InstallStatus install={status.data?.install?.find(item => `mcp/${item.name}` === target)} retry={() => void request("integrations/install", {}).then(status.refresh, e => setError((e as Error).message))} />}
      {diagnostic?.diagnostic ? <div aria-label="Diagnostic results" className="space-y-2 text-sm"><p>Checked {new Date(diagnostic.diagnostic.checkedAt).toLocaleString()}{target.startsWith("acp/") ? ` · Model: ${diagnostic.diagnostic.model || "provider default"}` : ""}</p>{diagnostic.diagnostic.checks.map((check, i) => <p key={i}>{check.stage}: {check.state} — {check.message}</p>)}</div> : <p className="text-sm">Connection and authentication have not been tested for this configuration.</p>}
      <p className="text-sm text-muted-foreground">{scope === "acp" ? "Complete provider sign-in using the provider’s login command, then test again." : "Chrome browser access and the LinkedIn MCP session are independent. LinkedIn may open its own sign-in window during the test."}</p>
      {notice && <p role="status">{notice}</p>}
      {(error || status.error || status.testError) && <p role="alert">{error || status.error || status.testError}</p>}
    </form>}
    {scope === "mcp" && <div className="mt-4 text-sm"><p>LaTeX and PDF tools</p>{status.data?.dependencies.map(tool => <p key={tool.command}>{tool.command}: {tool.available ? "available" : "missing — install it and add it to PATH"}</p>)}<Button className="mt-2" size="sm" variant="outline" onClick={status.refresh}>Recheck installed tools</Button></div>}
  </Panel>
}
