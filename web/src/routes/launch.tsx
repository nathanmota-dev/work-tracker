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
import { publish, request } from "@/lib/api"
import {
  Page,
  Panel,
  LoadState,
} from "@/components/workspace-ui"
import { useApi, useConnection, type Row } from "@/lib/api"
import { useAgent, runAgent, supportedEffort, type Providers } from "@/lib/agent"

/** Launch field → the Profile answer it shares. */
const SHARED_FIELDS = { query: "desired_role", location: "preferred_locations" } as const

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
  // Role and location of a job search are the Profile's desired roles and preferred locations: one value for both screens.
  const shared = skill === "job-scout" ? SHARED_FIELDS : {}
  const [edited, setEdited] = useState<Record<string, string>>({})
  const saving = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const saved = (key: string) => String(profile.data?.find(row => row.key === key && (row.language ?? "default") === "default")?.value ?? "")
  const params: Record<string, string> = Object.fromEntries(["query", "location", "company", "username", "url", "jobIds"].flatMap(key => {
    const answer = key in shared ? edited[key] ?? (saved(shared[key as keyof typeof shared]) || remembered[key as keyof typeof remembered]) : undefined
    const value = search[key as keyof typeof search] || answer || (key in shared ? undefined : remembered[key as keyof typeof remembered])
    return typeof value === "string" && value ? [[key, value]] : []
  }))
  if (context.draft.extra) params.extra = context.draft.extra
  const setParams: React.Dispatch<React.SetStateAction<Record<string, string>>> = change => {
    const next = typeof change === "function" ? change(params) : change
    if (next.extra !== params.extra) context.update({ extra: next.extra ?? "" })
    if (rememberedLaunchFields.some(key => next[key] !== params[key])) writeLaunchFields(skill, next)
    for (const [field, answerKey] of Object.entries(shared)) {
      if ((next[field] ?? "") === (params[field] ?? "")) continue
      const value = next[field] ?? ""
      setEdited(previous => ({ ...previous, [field]: value }))
      clearTimeout(saving.current[field])
      saving.current[field] = setTimeout(() => {
        void request("answer", { key: answerKey, value: value.trim(), category: "profile" }).then(() => publish({ type: "changed", table: "applicant_answers" })).catch(() => undefined)
      }, 600)
    }
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
