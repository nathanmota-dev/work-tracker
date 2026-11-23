import { useEffect, useRef, useState } from "react"
import { AgentConversation } from "@/components/agent-conversation"
import { CompanyResearchNote } from "@/components/company-research-note"
import { InterviewPrepPacks } from "@/components/interview-prep-packs"
import {
  AgentSelectors,
  RunFooter,
  WorkspaceActions,
  type AgentSelection,
} from "@/components/launch-form"
import { SelectControl } from "@/components/ui/select-control"
import { Input } from "@/components/ui/input"
import { Empty, Field, LoadState, Page, Panel, Status, controlClass } from "@/components/workspace-ui"
import { runAgent, supportedEffort, useAgent, type Providers } from "@/lib/agent"
import { text, useApi, useConnection, type Row } from "@/lib/api"

const SKILL = "interview-prep"
const STAGES = ["Recruiter screen", "Technical interview", "Take-home or case", "Final round", "Offer discussion"]
type Draft = Record<"stage" | "date" | "format" | "interviewers" | "extra", string>

function label(row: Row) {
  return `${text(row.company_name)} — ${text(row.job_title)}`
}

function useAgentChoice(): AgentSelection & { providers: Providers["providers"]; loading: boolean; error: string; retry: () => void } {
  const api = useApi<Providers>("acp/providers")
  const [choice, setChoice] = useState({ provider: "", model: "", effort: "" })
  const providers = api.data?.providers ?? []
  const selectedProvider = providers.find((p) => p.id === choice.provider) ?? providers.find((p) => p.id === api.data?.default) ?? providers[0]
  return {
    providers, selectedProvider, loading: api.loading, error: api.error, retry: api.refresh,
    effectiveModel: selectedProvider?.models.includes(choice.model) ? choice.model : "",
    effectiveEffort: supportedEffort(selectedProvider, choice.effort),
    onProvider: (provider) => setChoice({ provider, model: "", effort: "" }),
    onModel: (model) => setChoice((c) => ({ ...c, model })),
    onEffort: (effort) => setChoice((c) => ({ ...c, effort })),
  }
}

export function InterviewPrepPage() {
  const applications = useApi<Row[]>("applications")
  const agent = useAgent()
  const live = useConnection()
  const choice = useAgentChoice()
  const [applicationId, setApplicationId] = useState("")
  const [draft, setDraft] = useState<Draft>({ stage: STAGES[0], date: "", format: "", interviewers: "", extra: "" })
  const [error, setError] = useState("")
  const open = (applications.data ?? []).filter((row) => row.tracking_status !== "archived")
  const selected = open.find((row) => String(row.id) === applicationId) ?? open[0]
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }) }, [agent.messages])
  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }))
  function submit() {
    setError("")
    if (!selected || !choice.selectedProvider || !live) return
    const { extra, ...details } = draft
    void runAgent(
      choice.selectedProvider.id,
      SKILL,
      { applicationId: String(selected.id), ...details, ...(extra.trim() ? { extra } : {}) },
      choice.effectiveModel || undefined,
      choice.effectiveEffort || undefined,
    )
  }
  return (
    <Page
      title="Interview prep"
      description="Walk into every round with likely questions, grounded answers and a consistency brief."
      actions={<Status value={agent.status} />}
    >
      <LoadState {...applications} retry={applications.refresh} />
      {applications.data && !open.length && (
        <Empty title="No applications to prepare for" description="Track an application first, then come back to prepare for its interviews." />
      )}
      {!!open.length && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel title="Build a pack">
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
              <Field label="Application">
                <SelectControl className={controlClass} value={String(selected?.id ?? "")} disabled={agent.running} onChange={(e) => setApplicationId(e.target.value)}>
                  {open.map((row) => <option key={String(row.id)} value={String(row.id)}>{label(row)}</option>)}
                </SelectControl>
              </Field>
              {typeof selected?.company_name === "string" && selected.company_name.trim() && <CompanyResearchNote key={selected.company_name} company={selected.company_name} />}
              <Field label="Stage">
                <Input className={controlClass} list="interview-stages" value={draft.stage} disabled={agent.running} onChange={(e) => set("stage")(e.target.value)} required />
                <datalist id="interview-stages">{STAGES.map((stage) => <option key={stage} value={stage} />)}</datalist>
              </Field>
              <Field label="Date">
                <Input className={controlClass} type="date" value={draft.date} disabled={agent.running} onChange={(e) => set("date")(e.target.value)} />
              </Field>
              <Field label="Format">
                <Input className={controlClass} placeholder="Phone, video, onsite" value={draft.format} disabled={agent.running} onChange={(e) => set("format")(e.target.value)} />
              </Field>
              <Field label="Interviewers">
                <Input className={controlClass} placeholder="Names and titles, if known" value={draft.interviewers} disabled={agent.running} onChange={(e) => set("interviewers")(e.target.value)} />
              </Field>
              <LoadState loading={choice.loading} error={choice.error} retry={choice.retry} />
              {!!choice.providers.length && <AgentSelectors {...choice} disabled={agent.running} />}
              <RunFooter extra={draft.extra} onExtra={set("extra")} running={agent.running} canRun={!!choice.selectedProvider && !!selected && live} live={live} waitingForSignIn={agent.status === "Waiting for sign-in"} />
            </form>
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Saved packs">
              {selected && <InterviewPrepPacks applicationId={Number(selected.id)} />}
            </Panel>
            <Panel title="Agent workspace" action={<WorkspaceActions agent={agent} onError={setError} />}>
              <AgentConversation messages={agent.messages} />
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div ref={end} />
            </Panel>
          </div>
        </div>
      )}
    </Page>
  )
}
