import { useCallback, useEffect, useState } from "react"
import { request, subscribe, type Row } from "./api"
import type { AgentMessage } from "./agent"
import { permissionDecision, type PermissionRequest } from "./permissions"
export type { ResumeSourcesConfig, SourcesState, PdfArtifact, PreparationRun, PreparationDetails, SubmissionConfirmation } from "../../../src/preparation/types"
import type { PreparationDetails } from "../../../src/preparation/types"
export function openApply(jobId?: unknown, applicationId?: unknown, runId?: string) {
  const params = new URLSearchParams()
  if (Number(jobId) > 0) params.set("jobId", String(jobId))
  if (Number(applicationId) > 0) params.set("applicationId", String(applicationId))
  if (runId) params.set("runId", runId)
  window.location.hash = `/apply${params.size ? `?${params}` : ""}`
}
export function preparationMessages(events: Row[], status?: string): AgentMessage[] {
  const messages: AgentMessage[] = []
  const tools = new Map<string, AgentMessage>()
  for (const [index, event] of events.entries()) {
    if (event.type === "acp-update") {
      const outer = event.update as Row | undefined
      const update = (outer?.update ?? outer) as Row | undefined
      const content = update?.content as Row | undefined
      if (update?.sessionUpdate === "agent_message_chunk" && content?.type === "text") {
        const last = messages.at(-1)
        if (last?.role === "agent" && !last.tool) last.text += String(content.text)
        else messages.push({ id: String(index), role: "agent", text: String(content.text) })
      } else if (["tool_call", "tool_call_update"].includes(String(update?.sessionUpdate))) {
        const key = String(update?.toolCallId ?? index)
        let message = tools.get(key)
        if (!message) { message = { id: `tool-${key}`, role: "system", text: "", tool: { title: "Tool activity", kind: "other", status: "pending", output: "" } }; tools.set(key, message); messages.push(message) }
        const tool = message.tool!
        if (update?.title) tool.title = String(update.title)
        if (update?.kind) tool.kind = String(update.kind)
        if (update?.status) tool.status = String(update.status)
        if (update?.rawInput !== undefined) tool.input = update.rawInput
        if (Array.isArray(update?.content)) tool.output = (update.content as Row[]).map(item => { const c = item.content as Row; return c?.type === "text" ? String(c.text) : "" }).join("\n")
      }
    } else if (event.type === "acp-permission" || event.type === "acp-permission-decision") {
      const permission = event.request as PermissionRequest
      messages.push({ id: String(index), role: "system", text: event.type === "acp-permission" ? `Waiting for decision: ${permission.title}` : permissionDecision(permission) })
    } else if (event.type === "acp-log" || event.type === "acp-error") messages.push({ id: String(index), role: "system", text: String(event.line ?? event.message), diagnostic: event.type === "acp-log" })
  }
  if (status && ["cancelled", "failed", "interrupted", "completed"].includes(status)) for (const message of messages) {
    if (message.tool && ["pending", "in_progress"].includes(message.tool.status)) message.tool.status = "interrupted"
  }
  return messages
}
export function usePreparation(jobId?: number, applicationId?: number) {
  const [data, setData] = useState<PreparationDetails>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(r => r + 1), [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = subscribe(event => {
      if (["changed", "acp-status", "connection"].includes(event.type) && !timer) timer = setTimeout(() => { timer = undefined; refresh() }, 250)
    })
    return () => { stop(); clearTimeout(timer) }
  }, [refresh])
  useEffect(() => {
    let active = true
    if (!jobId) { setData(undefined); setError(""); setLoading(false); return }
    setLoading(true)
    request<PreparationDetails>("application-preparation/details", { jobId, applicationId })
      .then(value => { if (active) { setData(value); setError("") } })
      .catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [jobId, applicationId, revision])
  useEffect(() => { if (!data?.busy) return; const timer = setInterval(refresh, 1500); return () => clearInterval(timer) }, [data?.busy, refresh])
  return { data, error, loading, refresh }
}
