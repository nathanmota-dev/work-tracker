import { openApply } from "@/lib/preparation"
import { useWorkspaceState } from "@/lib/workspace-state"
import { useContextDraft } from "@/lib/context-draft"
import { readLaunchFields, rememberedLaunchFields, writeLaunchFields } from "@/lib/launch-fields"
import { candidateFromAnswers } from "@/lib/candidate-profile"
import { AgentConversation } from "@/components/agent-conversation"
import {
  AgentSelectors,
  type AgentSelection,
  RunFooter,
  SkillFields,
  SkillPicker,
  WorkspaceActions,
  launchSkills,
} from "@/components/launch-form"
import { useEffect, useRef, useState } from "react"
import {
  Page,
  Panel,
  LoadState,
  Status,
} from "@/components/workspace-ui"
import { useApi, useConnection, type Row } from "@/lib/api"
import { useAgent, runAgent, supportedEffort, type Providers } from "@/lib/agent"

function useLaunchState() {
  const profile = useApi<Row[]>("answers")
  const candidate = candidateFromAnswers(profile.data ?? [])
  const api = useApi<Providers>("acp/providers")
  const agent = useAgent()
  const live = useConnection()
  const { search, update } = useWorkspaceState("launch")
  const skill = search.skill ?? "job-scout"
  const setSkill = (skill: string) => update({ skill, target: "", query: "", location: "", company: "", username: "", url: "", jobIds: "" })
  const context = useContextDraft(`launch:${skill}:${search.target ?? ""}`)
  const remembered = readLaunchFields(skill)
  const params: Record<string, string> = Object.fromEntries(["query", "location", "company", "username", "url", "jobIds"].flatMap(key => {
    const value = search[key as keyof typeof search] || remembered[key as keyof typeof remembered]
    return typeof value === "string" && value ? [[key, value]] : []
  }))
  if (context.draft.extra) params.extra = context.draft.extra
  const setParams: React.Dispatch<React.SetStateAction<Record<string, string>>> = change => {
    const next = typeof change === "function" ? change(params) : change
    if (next.extra !== params.extra) context.update({ extra: next.extra ?? "" })
    if (rememberedLaunchFields.some(key => next[key] !== params[key])) writeLaunchFields(skill, next)
    update(Object.fromEntries(Object.entries(next).filter(([key]) => key !== "extra")))
  }
  const provider = search.provider ?? localStorage.getItem("work-tracker-provider") ?? ""
  const model = search.model ?? localStorage.getItem("work-tracker-model") ?? ""
  const effort = search.effort ?? localStorage.getItem("work-tracker-effort") ?? ""
  const [error, setError] = useState("")
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" })
  }, [agent.messages])
  const selectedProvider =
    api.data?.providers.find((p) => p.id === provider) ??
    api.data?.providers.find((p) => p.id === api.data?.default) ??
    api.data?.providers[0]
  const effectiveModel = selectedProvider?.models.includes(model) ? model : ""
  const effectiveEffort = supportedEffort(selectedProvider, effort)
  const selection: AgentSelection = {
    selectedProvider, effectiveModel, effectiveEffort,
    onProvider: provider => update({ provider, model: "", effort: "" }),
    onModel: model => update({ model }),
    onEffort: effort => update({ effort }),
  }
  const selected = launchSkills.find((s) => s.id === skill) ?? launchSkills[0]
  function submit() {
    setError("")
    if (!selectedProvider || !live) return
    if (skill === "portal-filler") {
      openApply(Number(params.jobIds?.trim()))
      return
    }
    void runAgent(
      selectedProvider.id,
      skill,
      params,
      effectiveModel || undefined,
      effectiveEffort || undefined,
    )
  }
  return {
    candidate,
    api,
    agent,
    live,
    skill,
    setSkill,
    params,
    setParams,
    error: error || context.error,
    setError,
    selectedProvider,
    selection,
    selected,
    submit,
  }
}

export function LaunchPage() {
  const {
    candidate,
    api,
    agent,
    live,
    skill,
    setSkill,
    params,
    setParams,
    error,
    setError,
    selectedProvider,
    selection,
    selected,
    submit,
  } = useLaunchState()
  return (
    <Page
      title="Agent console"
      description="Your next move, with a little help from your agent."
      actions={<Status value={agent.status} />}
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Run a skill">
          <p className="text-sm text-muted-foreground">Preparing an application opens Apply, where you review and approve the document before filling.</p>
          <LoadState {...api} retry={api.refresh} />
          {api.data && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <AgentSelectors
                providers={api.data.providers}
                disabled={agent.running}
                {...selection}
              />
              <SkillPicker
                skill={skill}
                description={selected.description}
                disabled={agent.running}
                onSkill={(value) => {
                  setSkill(value)
                }}
              />
              <SkillFields
                fields={selected.fields}
                skill={skill}
                params={params}
                setParams={setParams}
                username={candidate.linkedinUsername}
                disabled={agent.running}
              />
              <RunFooter
                extra={params.extra ?? ""}
                onExtra={(extra) => setParams((p) => ({ ...p, extra }))}
                running={agent.running}
                canRun={!!selectedProvider && live}
                live={live}
                waitingForSignIn={agent.status === "Waiting for sign-in"}
              />
            </form>
          )}
        </Panel>
        <Panel
          title="Agent workspace"
          action={
            <WorkspaceActions agent={agent} onError={setError} />
          }
        >
          <AgentConversation messages={agent.messages} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </Panel>
      </div>
    </Page>
  )
}
