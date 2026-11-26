import { useEffect, useRef } from "react"
import { Bot, Sparkles } from "lucide-react"
import { AgentActivity } from "@/components/agent-activity"
import { Markdown } from "@/components/markdown"
import { Empty } from "@/components/workspace-ui"
import type { AgentMessage } from "@/lib/agent"
/** @param fill The log takes the remaining height of its container instead of a height of its own. */
export function AgentConversation({ messages, fill }: { messages: AgentMessage[]; fill?: boolean }) {
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => { if (log.current && messages.length) log.current.scrollTop = log.current.scrollHeight }, [messages])
  return <div ref={log} role="log" aria-label="Agent conversation" aria-live="polite" className={`${fill ? "min-h-0 flex-1" : "h-[calc(100dvh-15rem)] min-h-[420px]"} space-y-4 overflow-y-auto pr-2`}>
    {!messages.length && <Empty title="Ready for your next step" description="Agent progress, tools and results will appear here."><Sparkles className="size-5 text-chart-1" /></Empty>}
    {messages.map(m => m.tool || m.diagnostic ? <AgentActivity key={m.id} message={m} /> : <div key={m.id} className={`rounded-xl border p-4 ${m.role === "user" ? "ml-8 bg-muted/40" : "mr-4"}`}>
      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">{m.role === "agent" && <Bot className="size-3.5" />}{m.role === "user" ? "You" : m.role === "agent" ? "Agent" : "Activity"}</p>
      {m.role === "agent" ? <Markdown text={m.text} /> : <div className="whitespace-pre-wrap break-words text-sm">{m.text}</div>}
    </div>)}
  </div>
}
