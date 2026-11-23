import { useState } from "react"
import { request, useApi, type Row } from "@/lib/api"
import type { Eligibility, GateProfile, GateVerdict, StoredGate } from "../../../src/gates/types"
export type { CandidateLanguage, Eligibility, GateFinding, GateProfile, GateResult, GateVerdict, StoredGate } from "../../../src/gates/types"

export const GATE_PROFILE_PATH = "gates/profile"
export const DEAL_BREAKERS_LINK = "#/profile?tab=deal-breakers"
export const jobGatePath = (jobId: unknown) => `gates/jobs/${Number(jobId)}`

export const ELIGIBILITY_LABELS: Record<Eligibility | "none", string> = {
  none: "Not set",
  citizen_or_resident: "Citizen or permanent resident",
  needs_permission: "I need a visa or work permit",
}

/** The verdict of a jobs row; anything else reads as not checked. */
export function rowVerdict(row: Row): GateVerdict {
  const verdict = row.gate_verdict
  return verdict === "pass" || verdict === "flag" || verdict === "fail" ? verdict : "unchecked"
}

/** The badge text, never only a color. */
export function gateLabel(verdict: GateVerdict, unverified = false) {
  if (verdict === "unchecked") return "Not checked"
  if (verdict === "pass") return unverified ? "Pass (unverified)" : "Pass"
  return verdict === "fail" ? "Fail" : "Flag"
}

export const isFailed = (row: Row) => rowVerdict(row) === "fail"

/** True when neither gate can fail a job yet. */
export const gatesOff = (profile?: GateProfile) => !!profile && !profile.languages.length && !profile.eligibility

export const saveLanguage = (language: { id?: number; language: string; level: string; notes?: string }) =>
  request<GateProfile>("gates/languages", language)
export const removeLanguage = (id: number) => request<GateProfile>("gates/languages", { action: "remove", id })
export const setEligibility = (eligibility: Eligibility | null) => request<GateProfile>("gates/eligibility", { eligibility })
export type JobGate = { gate: StoredGate | null }

/**
 * The stored check of the job being prepared and the user's confirmation of a
 * failed one, which Apply asks for before generating.
 */
export function useGateConfirmation(jobId: unknown) {
  const gate = useApi<JobGate>(jobGatePath(jobId))
  const [confirmed, setConfirmed] = useState(false)
  return {
    unconfirmed: gate.data?.gate?.verdict === "fail" && !confirmed,
    readiness: { value: gate.data?.gate, confirmed, confirm: () => setConfirmed(true) },
  }
}
