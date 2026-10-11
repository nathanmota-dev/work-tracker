import { candidateFromAnswers } from "@/lib/candidate-profile"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { useEffect, useRef, useState } from "react"
import { Bot, Play, Square, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Page,
  Panel,
  Field,
  controlClass,
  LoadState,
  Empty,
  Status,
} from "@/components/workspace-ui"
import { useApi, useConnection, type Row } from "@/lib/api"
import {
  skills,
  useAgent,
  runAgent,
  cancelAgent,
  clearAgent,
  type Providers,
} from "@/lib/agent"
const labels: Record<string, string> = {
  query: "Role, keywords or job URL",
  location: "Location",
  jobIds: "Saved job IDs",
  username: "LinkedIn username",
  company: "Target company",
  url: "Application URL",
}
export function LaunchPage() {
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
  const selected = skills.find((s) => s.id === skill) ?? skills[0]
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
              }}
            >
              <Field label="Agent">
                <SelectControl
                  className={controlClass}
                  value={selectedProvider?.id ?? ""}
                  disabled={agent.running}
                  onChange={(e) => {
                    setProvider(e.target.value)
                    setModel("")
                  }}
                >
                  {api.data.providers.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </SelectControl>
              </Field>
              <Field label="Model">
                <SelectControl
                  className={controlClass}
                  value={effectiveModel}
                  disabled={agent.running}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">Provider default</option>
                  {selectedProvider?.models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </SelectControl>
              </Field>
              <Field label="Skill">
                <SelectControl
                  className={controlClass}
                  value={skill}
                  disabled={agent.running}
                  onChange={(e) => {
                    setSkill(e.target.value)
                    setParams({})
                  }}
                >
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </SelectControl>
              </Field>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {selected.description}
              </p>
              {selected.fields.map((key) => (
                <Field key={key} label={labels[key]}>
                  <Input
                    value={
                      params[key] ??
                      (key === "username" ? candidate.linkedinUsername : "")
                    }
                    disabled={agent.running}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, [key]: e.target.value }))
                    }
                    required={
                      ["query", "jobIds"].includes(key) &&
                      skill !== "portal-filler"
                    }
                  />
                </Field>
              ))}
              <Field label="Additional context">
                <Textarea
                  className={`${controlClass} h-28 resize-y py-2`}
                  placeholder="What should the agent know?"
                  disabled={agent.running}
                  value={params.extra ?? ""}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, extra: e.target.value }))
                  }
                />
              </Field>
              <Button
                className="w-full"
                disabled={agent.running || !selectedProvider || !live}
              >
                <Play className="size-4" />
                Run agent
              </Button>
              {!live && (
                <p className="text-xs text-muted-foreground">
                  Waiting for the live connection before starting a run.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Include everything the agent needs before starting. You can
                adjust context in your next run.
              </p>
            </form>
          )}
        </Panel>
        <Panel
          title="Agent workspace"
          action={
            <div className="flex gap-2">
              {agent.running ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void cancelAgent().catch((e) => setError(e.message))
                  }
                >
                  <Square />
                  Cancel
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!agent.messages.length}
                  onClick={clearAgent}
                >
                  Clear
                </Button>
              )}
            </div>
          }
        >
          <div
            role="log"
            aria-label="Agent conversation"
            aria-live="polite"
            className="h-[540px] space-y-4 overflow-y-auto pr-2"
          >
            {!agent.messages.length && (
              <Empty
                title="Make room for your next opportunity"
                description="Choose a skill and give your agent a clear starting point. Progress and results will appear here."
              >
                <Sparkles className="size-5 text-chart-1" />
              </Empty>
            )}
            {agent.messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-xl border p-4 ${m.role === "user" ? "ml-8 bg-muted/40" : "mr-4"}`}
              >
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {m.role === "agent" && <Bot className="size-3.5" />}
                  {m.role === "user"
                    ? "You"
                    : m.role === "agent"
                      ? "Agent"
                      : "Activity"}
                </p>
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
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
