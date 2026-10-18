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
