/** Provider of a run that reuses a saved resume variant instead of calling an agent. */
export const SAVED_RESUME = "saved-resume";
/** Provider of a run that uses the base resume as it is, without tailoring. */
export const BASE_RESUME = "base-resume";
/** A run that used a ready PDF: no agent generated it, so it is filled but never regenerated. */
export const usesReadyPdf = (provider: string): boolean => provider === SAVED_RESUME || provider === BASE_RESUME;
export type LatexEngine = "pdflatex" | "xelatex" | "lualatex";
export interface ResumeSourcesConfig {
  projectDir: string;
  mainFile: string;
  dataFile: string;
  engine: LatexEngine;
  /** Folder with the data file, the LinkedIn export and reference resumes; empty for none. */
  profileDir: string;
}
export interface PdfArtifact {
  id: string;
  /** `variant` is a saved resume variant's PDF; it never serves as a base preview. */
  kind: "base" | "tailored" | "variant";
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
  job: { id: number; title: string; company_name: string; description: string | null; description_guard_json?: string | null; link: string | null; archived_at: string | null; linkedin_job_id?: string | null };
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
    /** The form the portal agent fills: the employer's link, or the LinkedIn posting until it is resolved. */
    external_url: string | null;
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
  /** The saved resume variant this version reuses; null for a tailored version. */
  variant?: { id: string; name: string; role: string; stacks: string[] } | null;
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

/** Where a batch item is in its pipeline. Pausing the batch or stopping the item keeps it. */
export type BatchItemPhase = "queued" | "preparing" | "tailoring" | "compiling" | "ready_for_review" | "waiting_for_fill" | "filling" | "in_review" | "submitted";
/**
 * What a batch item is doing in its phase: `pending` waits for the executor,
 * `waiting_for_user` for an approval or a manual submission in the browser.
 */
export type BatchItemStatus = "pending" | "running" | "waiting_for_decision" | "waiting_for_sign_in" | "waiting_for_user" | "failed" | "interrupted" | "cancelled" | "completed";
/**
 * One job of a batch, processed in position order by a single agent.
 *
 * @property holdsPortal Its form is waiting in the browser (or may hold a partial
 *   fill), so no other application is filled until it is submitted or cancelled.
 * @property reviewRequired The last fill stopped without a result; retrying it needs the candidate's review.
 */
export interface PreparationBatchItem {
  id: string;
  batchId: string;
  position: number;
  jobId: number;
  company: string;
  title: string;
  applicationId: number | null;
  runId: string | null;
  phase: BatchItemPhase;
  status: BatchItemStatus;
  attempts: number;
  holdsPortal: boolean;
  reviewRequired: boolean;
  retryable: boolean;
  extra: string;
  error: string | null;
  updatedAt: string;
  result: BatchReviewResult;
  /** Last requested document adjustment, retained across retries and restarts. */
  adjustment: string | null;
}
/** A persisted batch; `completed` is derived when every item is submitted or cancelled. */
export interface PreparationBatch {
  id: string;
  status: "active" | "paused" | "cancelled" | "completed";
  pauseReason: "user" | "restart" | null;
  provider: string;
  model: string | null;
  extra: string;
  sourceVersion: string;
  createdAt: string;
  updatedAt: string;
  items: PreparationBatchItem[];
  counts: Partial<Record<BatchItemStatus, number>>;
  summary: Record<BatchReviewResult, number>;
}
/** Mutually exclusive results: every batch item contributes exactly once. */
export type BatchReviewResult = "prepared" | "filled" | "submitted" | "failed" | "cancelled" | "pending";
export interface PreparationQueueState {
  batches: PreparationBatch[];
  /** The item whose form currently reserves the browser portal. */
  portal: { batchId: string; itemId: string; applicationId: number | null; jobId: number; label: string } | null;
  busy: boolean;
}

export type BatchEligibility = { jobId: number; title: string; company: string; eligible: boolean; reasons: string[]; missing: string[] };
export type BatchPreview = { selected: number; eligible: number; excluded: number; items: BatchEligibility[] };
