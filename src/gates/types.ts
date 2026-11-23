/** Work eligibility the user declares; null turns the eligibility gate off. */
export const ELIGIBILITY_STATUSES = ["citizen_or_resident", "needs_permission"] as const;
export type Eligibility = (typeof ELIGIBILITY_STATUSES)[number];

export type Verdict = "pass" | "flag" | "fail";
/** A gate the user has not enabled yet reports `off` and never fails a job. */
export type GateStatus = Verdict | "off";
/** `unchecked` means the job has no stored check (saved before the gates or never checked). */
export type GateVerdict = Verdict | "unchecked";

/**
 * One language the posting requires for the job itself, as the skill read it.
 *
 * @property language Name as the user declared it when it is the same language.
 * @property [stated_bar] Level the posting asks for, as written ("fluent", "C1+").
 * @property bar_above_declared The skill's judgment: does the bar read as higher
 *   than the declared level? `unknown` is treated as a gap to flag.
 * @property quote Literal requirement line from the posting.
 */
export interface LanguageRequirement {
  language: string;
  stated_bar?: string;
  bar_above_declared: boolean | "unknown";
  quote: string;
}

/**
 * What the posting says about who may hold the job.
 *
 * @property names_permit_or_sponsors The posting names the user's permit class,
 *   welcomes international applicants or sponsors visas.
 * @property program_confirmed When that acceptance comes from a company-wide
 *   statement: whether this role or program is on its list. A statement in the
 *   posting itself counts as `true`.
 * @property [quote] Literal wording; required when any flag above is true.
 */
export interface EligibilityRequirement {
  requires_citizenship_or_pr: boolean;
  requires_clearance: boolean;
  names_permit_or_sponsors: boolean;
  program_confirmed: boolean | "unknown";
  quote?: string;
}

/** The extraction the requirements-check skill hands over for one job. */
export interface GateExtraction {
  languages: LanguageRequirement[];
  eligibility: EligibilityRequirement;
}

/** One finding that weighs on a gate, with the posting text it rests on. */
export interface GateFinding {
  verdict: Verdict;
  note: string;
  quote?: string;
}

export interface GateResult {
  status: GateStatus;
  summary: string;
  findings: GateFinding[];
}

/**
 * @property unverified A pass that rests on silence (or on no enabled gate),
 *   not on wording that permits the job.
 */
export interface GateEvaluation {
  verdict: Verdict;
  unverified: boolean;
  language: GateResult;
  eligibility: GateResult;
  checked_at: string;
}

/** `jobs.gate_json`: the evaluation plus the extraction, so a profile change can re-evaluate it. */
export interface StoredGate extends GateEvaluation {
  version: 1;
  extraction: GateExtraction;
}

export interface CandidateLanguage {
  id: number;
  language: string;
  level: string;
  notes: string | null;
}

export interface GateProfile {
  languages: CandidateLanguage[];
  eligibility: Eligibility | null;
}

/** A gate input or profile change that cannot be stored; `status` is the HTTP status. */
export class GateError extends Error {
  override name = "GateError";
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
