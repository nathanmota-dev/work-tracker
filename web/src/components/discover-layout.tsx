import type { ReactNode } from "react"
import { Panel } from "@/components/workspace-ui"
import { agentSetupLink } from "@/lib/integrations"
import type { useDefaultAgent } from "@/lib/default-agent"

/**
 * The layout every Discover view shares: the form on the left, its output on the right,
 * both columns the same size. From lg up they fill the visible height and each scrolls on its own.
 */
export function DiscoverLayout({ title, output, outputTitle = "Agent workspace", bare, children }: {
  title: string
  output: ReactNode
  outputTitle?: string
  /** The output brings its own panels, so it only gets the column and its scroll. */
  bare?: boolean
  children: ReactNode
}) {
  return <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
    <div className="flex min-h-0 flex-col"><Panel title={title} fill><div className="min-h-0 flex-1 overflow-y-auto">{children}</div></Panel></div>
    {/* Bare output cards stretch to the column's height like the left panel, and grow (scrolling) when longer. */}
    {bare ? <div className="flex h-[70dvh] min-h-0 flex-col gap-4 overflow-y-auto lg:h-auto [&>*]:flex-1">{output}</div>
      : <div className="flex h-[70dvh] min-h-0 flex-col lg:h-auto"><Panel title={outputTitle} fill>{output}</Panel></div>}
  </div>
}

/** Which agent a Discover run uses, with a way to change the default. */
export function AgentRunNote({ agent, live }: { agent: ReturnType<typeof useDefaultAgent>; live: boolean }) {
  return <>
    <p className="text-xs text-muted-foreground">Runs with {agent.selectedProvider?.displayName ?? "your agent"}{agent.effectiveModel ? ` · ${agent.effectiveModel}` : ""}. <a href={agentSetupLink()} className="underline">Change in Agent setup</a></p>
    {!live && <p className="text-xs text-muted-foreground">Waiting for the live connection before starting a run.</p>}
  </>
}
