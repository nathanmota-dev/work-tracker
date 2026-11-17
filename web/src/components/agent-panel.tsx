import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useApi, useConnection } from "@/lib/api"
import { candidateFromAnswers } from "@/lib/candidate-profile"
import type { Row } from "@/lib/api"
import { dismissAgentCompletion, runAgent, setAgentPanelOpen, skills, supportedEffort, updateAgentDraft, useAgent, type Providers } from "@/lib/agent"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { AgentConversation } from "@/components/agent-conversation"
import { AgentIndicator } from "@/components/agent-indicator"
import { AgentSelectors, RunFooter, SkillFields, WorkspaceActions } from "@/components/launch-form"
import { BrowserSignIn } from "@/components/browser-sign-in"
import { LoadState } from "@/components/workspace-ui"
import { SetupNotice } from "@/components/get-started"
import { reviewPermission } from "@/components/agent-permissions"
import type { PermissionSnapshot } from "@/lib/permissions"

function AgentPanelForm() {
  const agent = useAgent()
  const api = useApi<Providers>("acp/providers")
  const profile = useApi<Row[]>("answers")
  const live = useConnection()
  const [provider, setProvider] = useState(() => localStorage.getItem("work-tracker-provider") ?? "")
  const [model, setModel] = useState(() => localStorage.getItem("work-tracker-model") ?? "")
  const [effort, setEffort] = useState(() => localStorage.getItem("work-tracker-effort") ?? "")
  const draft = agent.draft ?? agent.current ?? { skill: "job-scout", params: {} }
  const selected = skills.find(skill => skill.id === draft.skill) ?? skills[0]
  const selectedProvider = api.data?.providers.find(item => item.id === provider) ?? api.data?.providers.find(item => item.id === api.data?.default) ?? api.data?.providers[0]
  const effectiveModel = selectedProvider?.models.includes(model) ? model : ""
  const effectiveEffort = supportedEffort(selectedProvider, effort)
  const setParams: React.Dispatch<React.SetStateAction<Record<string, string>>> = change => {
    updateAgentDraft({ ...draft, params: typeof change === "function" ? change(draft.params) : change })
  }
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    if (selectedProvider && live) void runAgent(selectedProvider.id, draft.skill, draft.params, effectiveModel || undefined, effectiveEffort || undefined)
  }}>
    <h3 className="font-medium">{selected.name}</h3>
    <p className="text-sm text-muted-foreground">{selected.description}</p>
    <LoadState {...api} retry={api.refresh} />
    <SetupNotice step="connect">Your agent and integrations have not passed a test yet, so this task may stop early.</SetupNotice>
    <SkillFields fields={selected.fields} skill={draft.skill} params={draft.params} setParams={setParams} username={candidateFromAnswers(profile.data ?? []).linkedinUsername} disabled={agent.running} />
    <details className="space-y-3">
      <summary className="cursor-pointer text-sm">Advanced</summary>
      {api.data && <AgentSelectors providers={api.data.providers} selectedProvider={selectedProvider} effectiveModel={effectiveModel} effectiveEffort={effectiveEffort} disabled={agent.running} onProvider={value => { setProvider(value); setModel(""); setEffort("") }} onModel={setModel} onEffort={setEffort} />}
      <Link to="/launch" onClick={() => setAgentPanelOpen(false)} className="text-sm underline">Open advanced console</Link>
    </details>
    <RunFooter extra={draft.params.extra ?? ""} onExtra={extra => setParams(params => ({ ...params, extra }))} running={agent.running} canRun={!!selectedProvider && live} live={live} waitingForSignIn={agent.status === "Waiting for sign-in"} />
  </form>
}

function PanelExecution() {
  const agent = useAgent()
  const permissions = useApi<PermissionSnapshot>("acp/permissions")
  const [error, setError] = useState("")
  return <>
    {agent.running && agent.draft && <p role="status" className="rounded border p-3 text-sm">An agent is already running. Your new task, {skills.find(skill => skill.id === agent.draft?.skill)?.name ?? agent.draft.skill}, is kept as a draft. Finish or stop the current run before starting it.</p>}
    {agent.current && <p className="text-sm">Current task: {skills.find(skill => skill.id === agent.current?.skill)?.name ?? agent.current.skill}</p>}
    <div className="flex items-center justify-between"><p className="text-sm">{agent.status}</p><WorkspaceActions agent={agent} onError={setError} /></div>
    {permissions.data?.pending.map(item => <Button key={item.id} variant="outline" onClick={() => reviewPermission(item.runId)}>Review permission: {item.title}</Button>)}
    {agent.status === "Waiting for sign-in" && <BrowserSignIn />}
    <AgentConversation messages={agent.messages} />
    {error && <p role="alert">{error}</p>}
  </>
}

const destinations = {
  "job-scout": { to: "/jobs", search: { view: "new" }, label: "View new jobs" },
  "recruiter-outreach": { to: "/contacts", search: { tab: "people" }, label: "View recruiters" },
  "outreach-tracker": { to: "/contacts", search: { tab: "follow-ups" }, label: "Review outreach" },
  "profile-optimizer": { to: "/profile", search: { tab: "linkedin" }, label: "View profile" },
} as const

export function AgentCompletion() {
  const { completion } = useAgent()
  if (!completion) return null
  const destination = destinations[completion.skill as keyof typeof destinations]
  return <div role="status" className="flex items-center gap-3 border-b bg-muted px-4 py-2 text-sm">
    <span>Agent task completed.</span>
    {destination && <Link to={destination.to} search={destination.search} className="underline" onClick={() => { setAgentPanelOpen(false); dismissAgentCompletion() }}>{destination.label}</Link>}
    <Button size="sm" variant="ghost" onClick={dismissAgentCompletion}>Dismiss</Button>
  </div>
}

export function AgentPanel() {
  const agent = useAgent()
  return <Sheet open={agent.panelOpen} onOpenChange={setAgentPanelOpen} modal={false}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl" onInteractOutside={event => event.preventDefault()}>
      <SheetHeader><SheetTitle>Agent task</SheetTitle><AgentIndicator /><SheetDescription>Run your task while keeping your place.</SheetDescription></SheetHeader>
      <div className="space-y-5 px-4 pb-6"><AgentPanelForm /><PanelExecution /></div>
    </SheetContent>
  </Sheet>
}
