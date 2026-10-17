import { describe, expect, test } from "vitest"
import * as board from "@/lib/application-board"
import * as preparation from "@/lib/preparation"
import type { Row } from "@/lib/api"

// Bind module exports once so the measured loops do not pay module-runner getter costs.
const { matchesApplication } = board
const { preparationMessages } = preparation

// Fixed synthetic inputs keep every run comparable across commits and runners.
const runOptions = { time: 1_000, warmupTime: 300, warmupIterations: 10 }
const companies = ["Ácme Labs", "Northwind", "Globex", "Initech"]
const applications: board.TrackedApplication[] = Array.from({ length: 5_000 }, (_, index) => ({
  id: index + 1,
  job_id: null,
  origin: "manual",
  attempt: 1,
  submission_status: "submitted",
  submitted_at: "2026-01-01T00:00:00.000Z",
  company_name: companies[index % companies.length]!,
  external_url: `https://jobs.example.test/${index + 1}`,
  role_title: index % 3 ? "Frontend Engineer" : "Platform Engineer",
  role_type: index % 2 ? "front_end" : "full_stack",
  stack: ["TypeScript", "React", index % 5 ? "Node.js" : "Go"],
  comp: null,
  company_url: null,
  notes: null,
  applied_at: "2026-01-01T00:00:00.000Z",
  current_stage_id: 1,
  tracking_status: "active",
  archive_reason: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
}))
const events: Row[] = Array.from({ length: 2_000 }, (_, index) => {
  const step = Math.floor(index / 4)
  switch (index % 4) {
    case 0:
      return { type: "acp-update", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Reviewing step ${step}` } } }
    case 1:
      return { type: "acp-update", update: { sessionUpdate: "tool_call", toolCallId: `tool-${step}`, title: "Read file", kind: "read", status: "pending" } }
    case 2:
      return { type: "acp-update", update: { sessionUpdate: "tool_call_update", toolCallId: `tool-${step}`, status: "completed", content: [{ content: { type: "text", text: `Output ${step}` } }] } }
    default:
      return { type: "acp-log", line: `Finished step ${step}` }
  }
})

function filterApplications() {
  return applications.filter((application) => matchesApplication(application, "acme"))
}

describe("frontend hot paths", () => {
  test("application board filtering", async ({ bench }) => {
    expect(filterApplications()).toHaveLength(1_250)
    await bench("filter 5000 applications", () => {
      filterApplications()
    }).run(runOptions)
  })

  test("preparation history assembly", async ({ bench }) => {
    const messages = preparationMessages(events, "completed")
    expect(messages).toHaveLength(1_500)
    expect(messages.filter((message) => message.tool?.status === "completed")).toHaveLength(500)
    expect(messages.at(-1)?.text).toBe("Finished step 499")
    await bench("assemble 2000 history events", () => {
      preparationMessages(events, "completed")
    }).run(runOptions)
  })
})
