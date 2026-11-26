import { useState } from "react"
import { publish, request, useApi } from "./api"
export type Target = "acp/opencode" | "acp/claude-code" | "mcp/chrome" | "mcp/linkedin"
export type Check = { stage: string; state: string; message: string }
export type Diagnostic = { target: Target; model: string; checkedAt: string; checks: Check[] }
export type IntegrationEntry = { target: Target; command: string; args: string[]; env: Record<string, string> }
export type IntegrationSettings = { revision: string; entries: IntegrationEntry[] }
export type McpInstall = import("../../../src/mcp/install/state").McpInstall
export type IntegrationStatus = { backend: boolean; entries: { target: Target; executable: boolean; diagnostic?: Diagnostic }[]; install?: McpInstall[]; dependencies: { command: string; available: boolean }[] }
export const integrationLabels: Record<Target, string> = { "acp/opencode": "opencode ACP", "acp/claude-code": "Claude Code ACP", "mcp/chrome": "Chrome MCP", "mcp/linkedin": "LinkedIn MCP" }
/** Agents are configured in Agent › Setup; MCP servers and installed tools in Settings › Integrations. */
export const agentSetupLink = (target?: Target) => `#/launch?tab=setup${target ? `&target=${encodeURIComponent(target)}` : ""}`
export const correctionLink = (target?: Target) => target?.startsWith("acp/") ? agentSetupLink(target) : `#/settings?section=integrations${target ? `&target=${encodeURIComponent(target)}` : ""}`
export function diagnosticBlocks(check: Check) { return !["ready", "unverified"].includes(check.state) }
export function useIntegrations() {
  const api = useApi<IntegrationStatus>("integrations/status")
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState("")
  async function test(targets: Target[], model = "") {
    setTesting(true); setError("")
    try {
      for (const target of targets) await request<Diagnostic>("integrations/test", { target, model: target.startsWith("acp/") ? model : "" })
      api.refresh(); publish({ type: "changed", table: "integrations" })
    } catch { setError("The diagnostic could not finish. Check the backend connection and test again.") }
    finally { setTesting(false) }
  }
  return { ...api, testing, test, testError: error }
}
