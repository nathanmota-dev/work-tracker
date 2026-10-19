export type LatexEngine = "pdflatex" | "xelatex" | "lualatex";
export interface ResumeSourcesConfig {
  projectDir: string;
  mainFile: string;
  dataFile: string;
  engine: LatexEngine;
}
export interface PdfArtifact {
  id: string;
  kind: "base" | "tailored";
  pages: number;
  warnings: string[];
}
export type PreparationPhase = "preparing" | "tailoring" | "compiling" | "review" | "filling";
/** Phase output that was validated and persisted, so a retry can skip it. */
export type RecoveryCheckpoint = "sources" | "tailored" | "compiled" | "filled";
/**
 * What a stopped execution kept and how it can continue. Derived from the run's
 * status, phase and persisted checkpoints; the desktop reads it after a restart.
 *
 * @property retryFrom Phase a retry continues from; null when nothing is pending.
 * @property reviewRequired The portal agent stopped without a result, so the
 *   portal may hold a partial fill. Filling again needs the candidate's review.
 * @property summary What stopped and what a retry does, for display.
 */
export interface RunRecovery {
  checkpoints: RecoveryCheckpoint[];
  retryFrom: Exclude<PreparationPhase, "review"> | null;
  reviewRequired: boolean;
  summary: string | null;
}
export interface PreparationRun {
  id: string;
  job_id: number;
  application_id: number | null;
  status: "running" | "completed" | "failed" | "cancelled" | "waiting_for_sign_in" | "interrupted";
  decisionStatus?: "waiting_for_permission";
  phase: PreparationPhase;
  provider: string;
  model: string | null;
  error: string | null;
  report: string | null;
  events: Record<string, unknown>[];
  artifacts: PdfArtifact[];
  recovery: RunRecovery;
  created_at: string;
  updated_at: string;
}
export interface PreparationDetails {
  job: { id: number; title: string; company_name: string; description: string | null; link: string | null; archived_at: string | null; linkedin_job_id?: string | null };
  runs: PreparationRun[];
  documents?: DocumentVersion[];
  /** Readable review of the application's last recorded portal fill; null before the first one. */
  fill?: FillReview | null;
  busy: boolean;
  applicationStatus: string | null;
  uploadedRunId: string | null;
  /** Independent journey dimensions of the selected application. */
  journey: {
    id: number;
    origin: string;
    attempt: number | null;
    preparation_status: string;
    fill_status: string;
    submission_status: string;
    submitted_at: string | null;
    review_reason: string | null;
  } | null;
}
/** Result of "I submitted in the browser"; a repeat reports the original submission. */
export interface SubmissionConfirmation {
  alreadySubmitted: boolean;
  applicationId: number;
  submittedAt: string | null;
}
export interface SourcesState {
  config: ResumeSourcesConfig;
  dependencies: { command: string; available: boolean }[];
  preview: PdfArtifact | null;
  warnings: string[];
  busy: boolean;
}

/** One validated PDF with the inputs used to generate it and its approval history. */
export interface DocumentVersion {
  id: string;
  runId: string;
  applicationId: number;
  pdfHash: string;
  sourceVersion: string;
  createdAt: string;
  approvedAt: string | null;
  usedAt: string | null;
  submittedAt: string | null;
  text: string;
  baseText: string;
  description: string;
  extra: string;
  data: unknown;
}

/** Why the portal agent left a field for the candidate; matches the matcher's skip codes. */
export type FillPendingReason = "no-stored-answer" | "invalid-answer" | "ambiguous" | "eeo-human-only" | "no-match" | "other";
/**
 * One portal field from the fill result, readable without its JSON.
 *
 * @property answer Value the agent entered; null for pending fields.
 * @property correctionKey Saved-answer key the candidate can add or correct in Answers.
 */
export interface FillChecklistItem {
  label: string;
  key: string | null;
  answer: string | null;
  result: "filled" | "pending";
  reason: FillPendingReason | null;
  reasonText: string | null;
  correctionKey: string | null;
}
/**
 * The last fill result stored on an application, with the portal and PDF it used.
 * Filling never submits: `submitted` reflects only the candidate's confirmation.
 */
export interface FillReview {
  applicationId: number;
  runId: string | null;
  portal: string;
  portalLabel: string;
  reviewUrl: string | null;
  document: { versionId: string; pdfHash: string; usedAt: string } | null;
  fillStatus: string;
  submitted: boolean;
  submittedAt: string | null;
  items: FillChecklistItem[];
  filled: number;
  pending: number;
  instruction: string;
}
