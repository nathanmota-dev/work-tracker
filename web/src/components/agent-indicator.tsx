import { useAgent } from "@/lib/agent"

export function agentIndicator(status: string, running: boolean) {
  if (/waiting/i.test(status)) return "Waiting"
  if (/error|exited|interrupted|lost/i.test(status)) return "Error"
  if (running) return "Running"
  if (status === "done") return "Done"
  return "Idle"
}

export function AgentIndicator() {
  const agent = useAgent()
  const label = agentIndicator(agent.status, agent.running)
  const color = { Idle: "bg-muted-foreground", Running: "bg-blue-500", Waiting: "bg-amber-500", Done: "bg-green-500", Error: "bg-destructive" }[label]
  return <span role="status" aria-label={`Agent status: ${label}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${color}`} /><span className="group-data-[collapsible=icon]:sr-only">{label}</span></span>
}
