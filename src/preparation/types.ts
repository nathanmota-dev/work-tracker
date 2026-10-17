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
export interface PreparationRun {
  id: string;
  job_id: number;
  application_id: number | null;
  status: "running" | "completed" | "failed" | "cancelled" | "waiting_for_sign_in" | "interrupted";
  phase: "preparing" | "tailoring" | "compiling" | "review" | "filling";
  provider: string;
  model: string | null;
  error: string | null;
  report: string | null;
  events: Record<string, unknown>[];
  artifacts: PdfArtifact[];
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
