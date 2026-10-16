import { candidateFromAnswers } from "@/lib/candidate-profile"
import { AgentConversation } from "@/components/agent-conversation"
import {
  AgentSelectors,
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
import { useAgent, runAgent, type Providers } from "@/lib/agent"

function useLaunchState() {
  const profile = useApi<Row[]>("answers")
  const candidate = candidateFromAnswers(profile.data ?? [])
  const api = useApi<Providers>("acp/providers")
  const agent = useAgent()
  const live = useConnection()
  const [skill, setSkill] = useState(agent.draft?.skill ?? "job-scout")
  const [params, setParams] = useState<Record<string, string>>(
    agent.draft?.params ?? {},
  )
  const [provider, setProvider] = useState(
    localStorage.getItem("work-tracker-provider") ?? "",
  )
  const [model, setModel] = useState(
    localStorage.getItem("work-tracker-model") ?? "",
  )
  const [error, setError] = useState("")
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (agent.draft) {
      setSkill(agent.draft.skill)
      setParams(agent.draft.params)
    }
  }, [agent.draft])
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" })
  }, [agent.messages])
  const selectedProvider =
    api.data?.providers.find((p) => p.id === provider) ??
    api.data?.providers.find((p) => p.id === api.data?.default) ??
    api.data?.providers[0]
  const effectiveModel = selectedProvider?.models.includes(model) ? model : ""
  const selected = launchSkills.find((s) => s.id === skill) ?? launchSkills[0]
  function submit() {
    setError("")
    if (!selectedProvider || !live) return
    if (
      skill === "portal-filler" &&
      !params.url?.trim() &&
      !params.jobIds?.trim()
    ) {
      setError("Enter an application URL or a saved job ID.")
      return
    }
    void runAgent(
      selectedProvider.id,
      skill,
      params,
      effectiveModel || undefined,
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
    setProvider,
    setModel,
    error,
    setError,
    selectedProvider,
    effectiveModel,
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
    setProvider,
    setModel,
    error,
    setError,
    selectedProvider,
    effectiveModel,
    selected,
    submit,
  } = useLaunchState()
  return (
    <Page
      title="Launch"
      description="Your next move, with a little help from your agent."
      actions={<Status value={agent.status} />}
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Run a skill">
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
                selectedProvider={selectedProvider}
                effectiveModel={effectiveModel}
                disabled={agent.running}
                onProvider={(value) => {
                  setProvider(value)
                  setModel("")
                }}
                onModel={setModel}
              />
              <SkillPicker
                skill={skill}
                description={selected.description}
                disabled={agent.running}
                onSkill={(value) => {
                  setSkill(value)
                  setParams({})
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
