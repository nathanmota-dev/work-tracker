import { CheckCircle2, ChevronRight, Clock3, CircleAlert, LoaderCircle, Terminal } from "lucide-react"
import { isLoginPending, type AgentMessage, type ToolActivity } from "@/lib/agent"
import { Badge } from "@/components/ui/badge"

const toolLabels: Record<string, string> = {
  get_person_profile: "Read LinkedIn profile",
  get_my_profile: "Read your LinkedIn profile",
  take_snapshot: "Inspect browser page",
  navigate_page: "Open browser page",
  list_pages: "List browser tabs",
  new_page: "Open browser tab",
}
function activityTitle(tool: ToolActivity): string {
  if (tool.kind === "execute" || /^(bash|sh|shell|terminal)$/.test(tool.title) || /^(cat|ls|sqlite3|sleep|rg|find|node|work-tracker)\s/.test(tool.title)) return "Run command"
  const name = tool.title.replace(/^(?:mcp__)?(?:linkedin|chrome)(?:__|_)/, "")
  return toolLabels[name] ?? name.replaceAll("_", " ")
}
function inputText(input: unknown): string {
  if (input === undefined) return ""
  if (typeof input === "string") return input
  return JSON.stringify(input, null, 2)
}
export function AgentActivity({ message }: { message: AgentMessage }) {
  const tool = message.tool
  const waiting = tool && isLoginPending(tool)
  const status = waiting ? "Waiting for sign-in" : ({
    pending: "Queued",
    in_progress: "Running",
    completed: "Completed",
    failed: "Failed",
    interrupted: "Interrupted",
  }[tool?.status ?? ""] ?? tool?.status ?? "Details")
  const Icon = waiting ? Clock3 : tool?.status === "in_progress" ? LoaderCircle : tool?.status === "completed" ? CheckCircle2 : tool?.status === "failed" ? CircleAlert : Terminal
  return (
    <div>
    <details className="group rounded-lg border bg-muted/15">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden="true" className={`size-4 shrink-0 ${waiting ? "text-amber-500" : tool?.status === "failed" ? "text-destructive" : "text-muted-foreground"} ${tool?.status === "in_progress" && !waiting ? "animate-spin" : ""}`} />
        <span className="min-w-0 flex-1 truncate font-medium">{tool ? activityTitle(tool) : "Agent diagnostics"}</span>
        {tool && <Badge variant="outline" className={waiting ? "border-amber-500/30 text-amber-600 dark:text-amber-400" : tool.status === "failed" ? "border-destructive/30 text-destructive" : "text-muted-foreground"}>{status}</Badge>}
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        {tool && <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Tool / command</p>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-words">{tool.title}</pre>
        </div>}
        {tool?.input !== undefined && <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Input</p>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-words">{inputText(tool.input)}</pre>
        </div>}
        {(tool?.output || message.text) && <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{tool ? "Output" : "Details"}</p>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-words">{tool?.output || message.text}</pre>
        </div>}
      </div>
    </details>
    {waiting && <p className="px-3 pt-2 text-xs text-muted-foreground">Sign-in has not completed. Finish in the browser, then run this skill again to retry.</p>}
    </div>
  )
}
