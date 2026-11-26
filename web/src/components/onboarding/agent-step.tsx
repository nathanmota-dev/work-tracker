import { useState } from "react"
import { CheckCircle2, CircleAlert, CircleDashed, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { IntegrationSettingsPanel } from "@/components/integration-settings"
import { useApi } from "@/lib/api"
import { diagnosticBlocks, useIntegrations, type IntegrationSettings, type Target } from "@/lib/integrations"
import type { OnboardingStatus } from "@/lib/onboarding"

type AgentState = "ready" | "failed" | "missing" | "untested"
const agents: { target: Target; provider: string; name: string; blurb: string; hint: string }[] = [
  { target: "acp/claude-code", provider: "claude-code", name: "Claude Code", blurb: "Anthropic's coding agent, through its ACP adapter.", hint: "Install the Claude Code ACP adapter (claude-code-acp) and sign in to Claude Code once in a terminal." },
  { target: "acp/opencode", provider: "opencode", name: "opencode", blurb: "Open-source agent that works with many model providers.", hint: "Install opencode, then sign in to a provider with opencode auth login." },
]
const badges: Record<AgentState, { label: string; className: string }> = {
  ready: { label: "Ready", className: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  failed: { label: "Test failed", className: "border-transparent bg-destructive/10 text-destructive" },
  missing: { label: "Not installed", className: "text-muted-foreground" },
  untested: { label: "Not tested", className: "text-muted-foreground" },
}

function initialProvider(ready: string[]) {
  let stored = ""
  try { stored = localStorage.getItem("work-tracker-provider") ?? "" } catch { /* private storage */ }
  return agents.find(agent => ready.includes(agent.target))?.target ?? agents.find(agent => agent.provider === stored)?.target ?? agents[0].target
}

function AgentCard({ agent, state, selected, onSelect }: { agent: typeof agents[number]; state: AgentState; selected: boolean; onSelect: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
    className={cn("flex w-full cursor-pointer items-start gap-3 rounded-xl border bg-background p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring",
      selected && "border-foreground ring-1 ring-foreground")}>
    <span aria-hidden className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", selected && "border-foreground")}>
      {selected && <span className="size-2 rounded-full bg-foreground" />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{agent.name}</span>
        <Badge variant="outline" className={badges[state].className}>{badges[state].label}</Badge>
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{agent.blurb}</span>
    </span>
  </button>
}

const checkIcon = (state: string) => state === "ready" ? CheckCircle2 : ["unverified", "skipped"].includes(state) ? CircleDashed : CircleAlert

/**
 * Choose Claude Code or opencode and run its diagnostic. A passing test is
 * what opens the app; the command can be adjusted under Advanced.
 */
export function AgentStep({ status }: { status?: OnboardingStatus }) {
  const integrations = useIntegrations()
  const settings = useApi<IntegrationSettings>("integrations")
  const ready = status?.readyAgents ?? []
  const [target, setTarget] = useState<Target>(() => initialProvider(ready))
  const [advanced, setAdvanced] = useState(false)
  const agent = agents.find(item => item.target === target)!
  const entry = integrations.data?.entries.find(item => item.target === target)
  const command = settings.data?.entries.find(item => item.target === target)?.command
  const stateOf = (id: Target): AgentState => {
    const item = integrations.data?.entries.find(value => value.target === id)
    if (ready.includes(id)) return "ready"
    if (item?.executable === false) return "missing"
    return item?.diagnostic?.checks.some(diagnosticBlocks) ? "failed" : "untested"
  }
  function select(id: Target) {
    setTarget(id)
    try { localStorage.setItem("work-tracker-provider", agents.find(item => item.target === id)!.provider) } catch { /* private storage */ }
  }
  return <div className="space-y-5">
    <div role="radiogroup" aria-label="Agent" className="grid gap-3 lg:grid-cols-2">
      {agents.map(item => <AgentCard key={item.target} agent={item} state={stateOf(item.target)} selected={item.target === target} onSelect={() => select(item.target)} />)}
    </div>
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Test {agent.name}</p>
          <p className="truncate text-xs text-muted-foreground">Command: <code className="font-mono">{command ?? "…"}</code> · {entry ? entry.executable ? "found" : "not found" : "checking"}</p>
        </div>
        <Button variant="default" size="sm" className="cursor-pointer" disabled={integrations.testing || !integrations.data}
          onClick={() => void integrations.test([target])}>
          {integrations.testing ? <><Loader2 className="animate-spin" /> Testing…</> : "Test agent"}
        </Button>
      </div>
      {stateOf(target) !== "ready" && <p className="text-xs leading-relaxed text-muted-foreground">{agent.hint}</p>}
      {entry?.diagnostic && <ul aria-label="Diagnostic results" className="space-y-1.5 border-t pt-3 text-xs">
        {entry.diagnostic.checks.map((check, index) => {
          const Icon = checkIcon(check.state)
          return <li key={index} className="flex gap-2">
            <Icon aria-hidden className={cn("mt-px size-3.5 shrink-0", check.state === "ready" ? "text-emerald-600 dark:text-emerald-400" : diagnosticBlocks(check) ? "text-destructive" : "text-muted-foreground")} />
            <span><span className="font-medium capitalize">{check.stage}</span> — {check.message}</span>
          </li>
        })}
      </ul>}
      {(integrations.error || integrations.testError) && <p role="alert" className="text-xs text-destructive">{integrations.testError || integrations.error}</p>}
    </div>
    <details className="text-sm" onToggle={event => setAdvanced(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Advanced: change the command or environment</summary>
      {/* Mounted only while open, so its own test button never doubles the one above. */}
      {advanced && <div className="mt-3"><IntegrationSettingsPanel key={target} scope="acp" /></div>}
    </details>
  </div>
}
