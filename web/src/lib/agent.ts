import { candidateFromAnswers, withCandidateProfile } from "./candidate-profile"
import { useSyncExternalStore } from "react"
import { request, subscribe, type Row } from "./api"
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
}
export type Providers = { providers: Provider[]; default: string }
type Message = { role: "user" | "agent" | "system"; text: string }
let state = {
  running: false,
  status: "Ready",
  messages: [] as Message[],
  draft: null as { skill: string; params: Record<string, string> } | null,
}
const observers = new Set<() => void>()
let listening = false
function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch }
  for (const listener of observers) listener()
}
function append(role: Message["role"], text: string, chunk = false) {
  const messages = [...state.messages]
  const last = messages.at(-1)
  if (chunk && last?.role === role)
    messages[messages.length - 1] = { role, text: last.text + text }
  else messages.push({ role, text })
  update({ messages: messages.slice(-500) })
}
function listen() {
  if (listening) return
  listening = true
  subscribe((event) => {
    if (event.type === "connection" && !event.live && state.running)
      update({ status: "Connection lost — run status unknown" })
    if (event.type === "acp-status")
      update({
        status: String(event.status),
        running: ["starting", "running"].includes(String(event.status)),
      })
    if (event.type === "acp-error") {
      append("system", String(event.message))
      update({ running: false, status: "Error" })
    }
    if (event.type === "acp-exit" && state.running)
      update({
        running: false,
        status: `Agent exited (${event.code ?? "unknown"})`,
      })
    if (event.type === "acp-log") append("system", String(event.line))
    if (event.type === "acp-permission")
      append(
        "system",
        "The agent requested a permission handled by the backend.",
      )
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
        const output = Array.isArray(value.content)
          ? (value.content as Row[])
              .map((item) => {
                const block = item.content as Row | undefined
                return block?.type === "text" ? String(block.text ?? "") : ""
              })
              .filter(Boolean)
              .join("\n")
          : ""
        append(
          "system",
          [String(value.title ?? "Tool activity"), value.status, output]
            .filter(Boolean)
            .join("\n"),
        )
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
  update({ draft: { skill, params } })
  window.location.hash = "/launch"
}
export async function runAgent(
  provider: string,
  skill: string,
  params: Record<string, string>,
  model?: string,
) {
  listen()
  if (state.running) return
  update({ running: true, status: "Starting", draft: null })
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
    })
  } catch (e) {
    append("system", (e as Error).message)
    update({ running: false, status: "Error" })
  }
}
export async function cancelAgent() {
  await request("acp/cancel", {})
  update({ status: "Cancelling" })
}
export function clearAgent() {
  if (!state.running) update({ messages: [], status: "Ready" })
}
