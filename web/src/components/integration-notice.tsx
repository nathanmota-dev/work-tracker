import type { ReactNode } from "react"
import { agentSetupLink, correctionLink, diagnosticBlocks, integrationLabels, useIntegrations, type Target } from "@/lib/integrations"
import { useOnboarding } from "@/lib/onboarding"

/**
 * Explains a blocker caused by an MCP server, only while it is missing,
 * still installing or failed its last test; `always` keeps it after an error.
 */
export function IntegrationNotice({ target, always = false, children }: { target: Target; always?: boolean; children: ReactNode }) {
  const { data } = useIntegrations()
  // Ignore anything that is not a status, such as a shared test double.
  const entry = Array.isArray(data?.entries) ? data.entries.find(item => item.target === target) : undefined
  const installing = Array.isArray(data?.install) && data.install.some(item => `mcp/${item.name}` === target && item.state === "installing")
  const broken = !!entry && (!entry.executable || !!entry.diagnostic?.checks.some(diagnosticBlocks))
  if (!always && !broken) return null
  return <p className="text-sm text-muted-foreground">
    {children} {installing && `${integrationLabels[target]} is still installing. `}
    <a className="underline" href={correctionLink(target)}>Check {integrationLabels[target]}</a>.
  </p>
}

/** Warns that no agent passes its test any more, for example after its command changed. */
export function AgentNotice({ children }: { children: ReactNode }) {
  const { status } = useOnboarding()
  if (!status || status.agentReady) return null
  return <p className="text-sm text-muted-foreground">{children} <a className="underline" href={agentSetupLink()}>Test your agent</a>.</p>
}
