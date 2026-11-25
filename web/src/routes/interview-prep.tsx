import { useEffect, useRef, useState } from "react"
import { Briefcase, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AgentConversation } from "@/components/agent-conversation"
import { WorkspaceActions } from "@/components/launch-form"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { CardGrid, CountLine } from "@/components/entity-card"
import { InterviewPrepForm, PREP_SKILL, applicationLabel, type AgentChoice, type PrepStart } from "@/components/interview-prep-form"
import { PackCard, PackSheet, type PrepPack } from "@/components/interview-prep-packs"
import { Empty, LoadState, Page, Panel, Status } from "@/components/workspace-ui"
import { supportedEffort, useAgent, type Providers } from "@/lib/agent"
import { text, useApi, useConnection, type Row } from "@/lib/api"
import { useWorkspaceState } from "@/lib/workspace-state"

function useAgentChoice(): AgentChoice {
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

/** The run's progress, shown only while an interview-prep run is on screen. */
function PrepWorkspace() {
  const agent = useAgent()
  const [error, setError] = useState("")
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }) }, [agent.messages])
  if (agent.current?.skill !== PREP_SKILL || !agent.running && !agent.messages.length) return null
  return (
    <Panel title="Building your pack" action={<div className="flex items-center gap-2"><Status value={agent.status} /><WorkspaceActions agent={agent} onError={setError} /></div>}>
      <div className="max-h-96 overflow-y-auto">
        <AgentConversation messages={agent.messages} />
        <div ref={end} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Panel>
  )
}

function PackBoard({ packs, onRebuild }: { packs: PrepPack[]; onRebuild: (pack: PrepPack) => void }) {
  const { search, update } = useWorkspaceState("interview-prep")
  const [application, setApplication] = useState("")
  const [open, setOpen] = useState<PrepPack | null>(null)
  const query = (search.q ?? "").toLowerCase()
  const shown = packs.filter(pack => (!application || String(pack.application_id) === application)
    && (!query || [pack.application?.company_name, pack.application?.job_title, pack.stage, pack.interviewers].some(value => text(value).toLowerCase().includes(query))))
  const options = [...new Map(packs.filter(pack => pack.application).map(pack => [String(pack.application_id), applicationLabel(pack.application!)])).entries()]
    .map(([value, label]) => ({ value, label }))
  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterSearch value={search.q ?? ""} placeholder="Company, role or stage" label="Search packs" onChange={q => update({ q })} />
        <FilterSelect icon={Briefcase} label="Application" value={application} anyLabel="All applications" options={options} onChange={setApplication} />
      </FilterBar>
      <CountLine label="Preparation packs" shown={shown.length} total={packs.length} />
      {!shown.length ? (
        <Empty title={packs.length ? "No matching packs" : "No preparation pack yet"}
          description={packs.length ? "Try a different search or filter." : "Build a pack before your next round: likely questions, grounded answers and a consistency brief."} />
      ) : (
        <CardGrid>{shown.map(pack => <PackCard key={String(pack.id)} pack={pack} onOpen={() => setOpen(pack)} onRebuild={onRebuild} />)}</CardGrid>
      )}
      <PackSheet pack={open} onClose={() => setOpen(null)} onRebuild={pack => { setOpen(null); onRebuild(pack) }} />
    </div>
  )
}

export function InterviewPrepPage() {
  const applications = useApi<Row[]>("applications")
  const packs = useApi<Row[]>("interview-preps")
  const agent = useAgent()
  const live = useConnection()
  const choice = useAgentChoice()
  const [building, setBuilding] = useState<PrepStart | null>(null)
  const open = (applications.data ?? []).filter((row) => row.tracking_status !== "archived")
  const byId = new Map((applications.data ?? []).map(row => [Number(row.id), row]))
  const list: PrepPack[] = (packs.data ?? []).map(pack => ({ ...pack, application: byId.get(Number(pack.application_id)) }))
  return (
    <Page
      title="Interview prep"
      description="Walk into every round with likely questions, grounded answers and a consistency brief."
      actions={<Button size="sm" disabled={!open.length || agent.running} onClick={() => setBuilding({})}><Plus /> Build pack</Button>}
    >
      <LoadState {...applications} loading={applications.loading && !applications.data} retry={applications.refresh} />
      <LoadState {...packs} loading={packs.loading && !packs.data} retry={packs.refresh} />
      {applications.data && !open.length && !list.length && (
        <Empty title="No applications to prepare for" description="Track an application first, then come back to prepare for its interviews." />
      )}
      <PrepWorkspace />
      {packs.data && applications.data && (open.length > 0 || list.length > 0) && (
        <PackBoard packs={list} onRebuild={pack => setBuilding({ applicationId: String(pack.application_id), stage: String(pack.stage ?? "") })} />
      )}
      {building && open.length > 0 && (
        <InterviewPrepForm applications={open} start={building} choice={choice} live={live} onClose={() => setBuilding(null)} />
      )}
    </Page>
  )
}
