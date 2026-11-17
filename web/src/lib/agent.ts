import type { SearchSaveResult } from "../../../src/jobs/search-results"
import { openApply } from "./preparation"
import { candidateFromAnswers, withCandidateProfile } from "./candidate-profile"
import { useSyncExternalStore } from "react"
import { request, subscribe, type Row } from "./api"
import { permissionDecision, type PermissionRequest, type PermissionSnapshot } from "./permissions"
export const skills = [
  {
    id: "job-scout",
    name: "Discover opportunities",
    description: "Find roles and build a shortlist matched to your profile.",
    fields: ["query", "location"],
  },
  {
    id: "deep-scout",
    name: "Assess a role",
    description: "Compare a specific opportunity against your experience.",
    fields: ["query"],
  },
  {
    id: "resume-tailor",
    name: "Tailor your resume",
    description: "Create tailored resumes, cover letters and match reports.",
    fields: ["jobIds"],
  },
  {
    id: "profile-optimizer",
    name: "Audit your profile",
    description: "Review visibility and find opportunities to improve.",
    fields: ["username"],
  },
  {
    id: "recruiter-outreach",
    name: "Find recruiters",
    description: "Discover relevant contacts at your target companies.",
    fields: ["company", "location"],
  },
  {
    id: "outreach-tracker",
    name: "Review follow-ups",
    description: "Review due actions and prepare your next messages.",
    fields: [],
  },
  {
    id: "portal-filler",
    name: "Prepare an application",
    description: "Fill an application portal for your review.",
    fields: ["url", "jobIds"],
  },
  {
    id: "experience-bank",
    name: "Capture experience",
    description: "Organize achievements and project experience.",
    fields: [],
  },
] as const
export type Provider = {
  id: string
  displayName: string
  models: string[]
  defaultModel?: string
  efforts?: string[]
}
export type Providers = { providers: Provider[]; default: string }
/** The stored effort when the provider supports it, otherwise the provider default. */
export function supportedEffort(provider: Provider | undefined, effort: string) {
  return provider?.efforts?.includes(effort) ? effort : ""
}
export type ToolActivity = {
  title: string
  kind: string
  status: string
  output: string
  input?: unknown
}
export type AgentMessage = {
  id: string
  role: "user" | "agent" | "system"
  text: string
  tool?: ToolActivity
  diagnostic?: boolean
}
let nextMessage = 0
let runId = 0
const toolMessages = new Map<string, string>()
export type AgentDraft = { skill: string; params: Record<string, string> }
let state = {
  jobOutcomes: [] as SearchSaveResult[],
  panelOpen: false,
  current: null as AgentDraft | null,
  completion: null as { skill: string; id: number } | null,
  running: false,
  status: "Ready",
  messages: [] as AgentMessage[],
  draft: null as AgentDraft | null,
}
const observers = new Set<() => void>()
let listening = false
function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch }
  for (const listener of observers) listener()
}
function append(role: AgentMessage["role"], text: string, chunk = false, diagnostic = false) {
  const messages = [...state.messages]
  const last = messages.at(-1)
  if (chunk && last?.role === role)
    messages[messages.length - 1] = { ...last, text: last.text + text }
  else messages.push({ id: String(++nextMessage), role, text, diagnostic })
  update({ messages: messages.slice(-500) })
}
export function isLoginPending(tool: ToolActivity): boolean {
  return !["completed", "interrupted"].includes(tool.status) && /\b(?:login (?:is still in|already in|in) progress|sign-in[^\n]*pending)\b/i.test(tool.output)
}
function interruptedMessages() {
  return state.messages.map(message => message.tool && (["pending", "in_progress"].includes(message.tool.status) || isLoginPending(message.tool))
    ? { ...message, tool: { ...message.tool, status: "interrupted" } } : message)
}
function updateTool(value: Row) {
  const key = typeof value.toolCallId === "string" ? `${runId}:${value.toolCallId}` : undefined
  const messageId = key ? toolMessages.get(key) : undefined
  const messages = [...state.messages]
  const index = messageId ? messages.findIndex(message => message.id === messageId) : -1
  const previous = index >= 0 ? messages[index] : undefined
  const tool: ToolActivity = {
    title: String(value.title ?? previous?.tool?.title ?? "Tool activity"),
    kind: String(value.kind ?? previous?.tool?.kind ?? "other"),
    status: String(value.status ?? previous?.tool?.status ?? "pending"),
    output: Array.isArray(value.content)
      ? (value.content as Row[]).map(item => {
          const block = item.content as Row | undefined
          return block?.type === "text" ? String(block.text ?? "") : ""
        }).filter(Boolean).join("\n")
      : previous?.tool?.output ?? "",
    input: value.rawInput ?? previous?.tool?.input,
  }
  const message: AgentMessage = { id: previous?.id ?? String(++nextMessage), role: "system", text: "", tool }
  if (index >= 0) messages[index] = message
  else messages.push(message)
  if (key) toolMessages.set(key, message.id)
  update({
    messages: messages.slice(-500),
    ...(state.running && isLoginPending(tool) ? { status: "Waiting for sign-in" } : {}),
    ...(state.running && state.status === "Waiting for sign-in" && tool.status === "completed" && (previous?.tool && isLoginPending(previous.tool) || /linkedin|get[ _](?:person|my)[ _]profile/i.test(tool.title)) ? { status: "running" } : {}),
  })
}
function listen() {
  if (listening) return
  listening = true
  subscribe((event) => {
    if (event.source === "apply") return;
    if (event.type === "changed" && event.jobSave && state.running && state.current?.skill === "job-scout")
      update({ jobOutcomes: [...state.jobOutcomes, event.jobSave as SearchSaveResult] })
    if ((event.type === "hello" || event.type === "connection" && event.live === true) && state.status === "Connection lost — run status unknown") {
      const currentRun = runId
      void request<PermissionSnapshot>("acp/permissions").then(snapshot => {
        if (currentRun !== runId || state.status !== "Connection lost — run status unknown") return
        const status = snapshot.execution?.status
        update({ running: status ? ["starting", "running", "waiting_for_permission"].includes(status) : false, status: status === "waiting_for_permission" ? "Waiting for decision" : status === "waiting_for_sign_in" ? "Waiting for sign-in" : status ?? "Interrupted", ...(!status || ["cancelled", "error"].includes(status) ? { messages: interruptedMessages() } : {}) })
      }).catch(() => {})
    }
    if (event.type === "connection" && !event.live && state.running)
      update({ status: "Connection lost — run status unknown" })
    if (event.type === "acp-status")
      update({
        ...(event.status === "done" && state.current && state.status !== "done" ? { completion: { skill: state.current.skill, id: runId } } : {}),
        status: event.status === "waiting_for_permission" ? "Waiting for decision" : event.status === "waiting_for_sign_in" ? "Waiting for sign-in" : String(event.status),
        running: ["starting", "running", "waiting_for_permission"].includes(String(event.status)),
        ...(event.status === "cancelled" ? { messages: interruptedMessages() } : {}),
      })
    if (event.type === "acp-error") {
      append("system", String(event.message))
      update({ running: false, status: "Error", messages: interruptedMessages() })
    }
    if (event.type === "acp-exit" && (state.running || state.status === "Waiting for sign-in"))
      update({
        running: false,
        status: `Agent exited (${event.code ?? "unknown"})`,
        messages: interruptedMessages(),
      })
    if (event.type === "acp-log") append("system", String(event.line), false, true)
    if (event.type === "acp-permission")
      append(
        "system",
        `Waiting for decision: ${(event.request as PermissionRequest).title}`,
      )
    if (event.type === "acp-permission-decision") append("system", permissionDecision(event.request as PermissionRequest))
    if (event.type === "acp-update") {
      const outer = event.update as Row | undefined
      const value = (outer?.update ?? outer) as Row | undefined
      const content = value?.content as Row | undefined
      if (
        value?.sessionUpdate === "agent_message_chunk" &&
        content?.type === "text"
      )
        append("agent", String(content.text ?? ""), true)
      else if (value?.sessionUpdate === "agent_thought_chunk") return
      else if (
        value?.sessionUpdate === "tool_call" ||
        value?.sessionUpdate === "tool_call_update"
      ) {
        updateTool(value)
      } else if (value?.title)
        append(
          "system",
          `${value.title}${value.status ? ` · ${value.status}` : ""}`,
        )
      else if (value?.sessionUpdate === "plan")
        append(
          "system",
          ((value.entries as Row[]) ?? [])
            .map((e) => `${e.status}: ${e.content}`)
            .join("\n"),
        )
    }
  })
}
export function useAgent() {
  return useSyncExternalStore(
    (listener) => {
      listen()
      observers.add(listener)
      return () => {
        observers.delete(listener)
      }
    },
    () => state,
  )
}
export function prepareSkill(
  skill: string,
  params: Record<string, string> = {},
) {
  if (skill === "resume-tailor") { openApply(params.jobIds); return }
  update({ draft: { skill, params }, panelOpen: true })
}
export async function runAgent(
  provider: string,
  skill: string,
  params: Record<string, string>,
  model?: string,
  effort?: string,
) {
  listen()
  if (state.running) { prepareSkill(skill, params); return }
  runId++
  toolMessages.clear()
  update({ jobOutcomes: [], running: true, status: "Starting", draft: null, current: { skill, params: { ...params } }, completion: null })
  append(
    "user",
    `${skills.find((s) => s.id === skill)?.name ?? skill}\n${Object.entries(
      params,
    )
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")}`,
  )
  try {
    const answers = await request<Row[]>("answers")
    const profileParams = withCandidateProfile(
      candidateFromAnswers(answers),
      skill,
      params,
    )
    await request("acp/run", {
      provider,
      skill,
      params: profileParams,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
    })
  } catch (e) {
    append("system", (e as Error).message)
    update({ running: false, status: "Error" })
  }
}
export async function cancelAgent() {
  const previous = { status: state.status, running: state.running }
  update({ status: "Cancelling", running: true })
  try { await request("acp/cancel", {}) }
  catch (error) { update(previous); throw error }
}
export function clearAgent() {
  if (!state.running && state.status !== "Waiting for sign-in") {
    toolMessages.clear()
    update({ messages: [], status: "Ready" })
  }
}

export function setAgentPanelOpen(panelOpen: boolean) { update({ panelOpen }) }
export function updateAgentDraft(draft: AgentDraft) { update({ draft }) }
export function dismissAgentCompletion() { update({ completion: null }) }
