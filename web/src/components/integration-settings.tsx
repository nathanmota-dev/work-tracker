import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { Field, LoadState, Panel, controlClass } from "@/components/workspace-ui"
import { publish, request, useApi } from "@/lib/api"
import { integrationLabels, useIntegrations, type IntegrationEntry, type IntegrationSettings, type Target } from "@/lib/integrations"
export function IntegrationSettingsPanel() {
  const api = useApi<IntegrationSettings>("integrations")
  const status = useIntegrations()
  const params = new URLSearchParams(window.location.hash.split("?")[1])
  const initial = params.get("target") as Target
  const [target, setTarget] = useState<Target>(initial in integrationLabels ? initial : "acp/opencode")
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
  return <Panel title="Integrations">
    <p className="mb-4 text-sm text-muted-foreground">Configure installed MCP servers and ACP agents. Stored arguments and environment values are hidden; keep their placeholders to preserve them or enter replacements. No dependencies are installed automatically.</p>
    <LoadState {...api} retry={api.refresh} />
    {api.data && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
      <Field label="Integration"><SelectControl className={controlClass} value={target} disabled={saving || status.testing || dirty} onChange={event => { setTarget(event.target.value as Target); setNotice(""); setError(""); setModel("") }}>{Object.entries(integrationLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</SelectControl></Field>
      {draft && <>
        <Field label="Executable command"><Input required value={draft.command} disabled={saving || status.testing} onChange={event => { setDraft({ ...draft, command: event.target.value }); setDirty(true); setNotice("") }} /></Field>
        <Field label="Arguments (JSON array)"><Textarea value={args} disabled={saving || status.testing} onChange={event => { setArgs(event.target.value); setDirty(true); setNotice("") }} /></Field>
        <Field label="Environment (JSON object)"><Textarea value={env} spellCheck={false} disabled={saving || status.testing} onChange={event => { setEnv(event.target.value); setDirty(true); setNotice("") }} /></Field>
        <div className="flex gap-2"><Button disabled={!dirty || saving || status.testing}>Save integration</Button><Button type="button" variant="outline" disabled={saving || status.testing} onClick={() => { setDirty(false); api.refresh(); setNotice(""); setError("") }}>Reload settings</Button></div>
      </>}
      {target.startsWith("acp/") && <Field label="Model to test (empty uses provider default)"><Input value={model} onChange={event => setModel(event.target.value)} /></Field>}
      <Button type="button" variant="outline" disabled={dirty || saving || status.testing} onClick={() => { setNotice(""); void status.test([target], model) }}>{status.testing ? "Testing integration…" : "Test saved integration"}</Button>
      <p className="text-sm">Executable: {diagnostic ? diagnostic.executable ? "available" : "missing" : "checking"}</p>
      {diagnostic?.diagnostic ? <div aria-label="Diagnostic results" className="space-y-2 text-sm"><p>Checked {new Date(diagnostic.diagnostic.checkedAt).toLocaleString()}{target.startsWith("acp/") ? ` · Model: ${diagnostic.diagnostic.model || "provider default"}` : ""}</p>{diagnostic.diagnostic.checks.map((check, i) => <p key={i}>{check.stage}: {check.state} — {check.message}</p>)}</div> : <p className="text-sm">Connection and authentication have not been tested for this configuration.</p>}
      <p className="text-sm text-muted-foreground">Chrome browser access and the LinkedIn MCP session are independent. Complete provider sign-in using the provider’s login command; LinkedIn may open its own sign-in window during the test.</p>
      {notice && <p role="status">{notice}</p>}
      {(error || status.error || status.testError) && <p role="alert">{error || status.error || status.testError}</p>}
    </form>}
    <div className="mt-4 text-sm"><p>LaTeX and PDF tools</p>{status.data?.dependencies.map(tool => <p key={tool.command}>{tool.command}: {tool.available ? "available" : "missing — install it and add it to PATH"}</p>)}<Button className="mt-2" size="sm" variant="outline" onClick={status.refresh}>Recheck installed tools</Button></div>
  </Panel>
}
