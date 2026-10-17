import type { ApplicationOrigin, ReviewReason, SubmissionStatus } from "./journey.ts";


export const ROLE_TYPES = {
  front_end: "Front-end",
  back_end: "Back-end",
  full_stack: "Full-stack",
} as const;
export const STAGE_CATEGORIES = {
  applied: "Application",
  recruiter: "Recruiter",
  technical: "Technical",
  assessment: "Assessment",
  offer: "Offer",
} as const;
export const ARCHIVE_REASONS = {
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  no_response: "No response",
  hired: "Hired",
} as const;

export type RoleType = keyof typeof ROLE_TYPES;
export type StageCategory = keyof typeof STAGE_CATEGORIES;
export type ArchiveReason = keyof typeof ARCHIVE_REASONS;

export interface ApplicationFields {
  company_name: string;
  external_url: string;
  role_title: string | null;
  role_type: RoleType | null;
  stack: string[];
  comp: string | null;
  company_url: string | null;
  notes: string | null;
  applied_at: string;
}
export type CreateApplication = Pick<
  ApplicationFields,
  "company_name" | "external_url"
> &
  Partial<ApplicationFields>;
export type UpdateApplication = Partial<ApplicationFields> & { id: number };
export interface TrackedApplication extends ApplicationFields {
  id: number;
  /** Local job ID; null for applications registered without a saved job. */
  job_id: number | null;
  origin: ApplicationOrigin;
  attempt: number | null;
  submission_status: SubmissionStatus;
  submitted_at: string | null;
  current_stage_id: number;
  tracking_status: "active" | "archived";
  archive_reason: ArchiveReason | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface ApplicationStage {
  id: number;
  key: string;
  name: string;
  category: StageCategory;
  position: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}
export interface ApplicationEvent {
  id: number;
  application_id: number;
  event_type: "created" | "moved" | "archived" | "reopened";
  from_stage_id: number | null;
  to_stage_id: number;
  stage_name: string;
  stage_category: StageCategory;
  occurred_at: string;
  reason: ArchiveReason | null;
  note: string | null;
}
export interface ApplicationBoard {
  stages: ApplicationStage[];
  applications: TrackedApplication[];
}
export interface ApplicationDetails {
  application: TrackedApplication;
  events: ApplicationEvent[];
}
export interface ApplicationActions {
  /** `request_id` makes a repeated registration return the first result. */
  /** `job_id` links a saved job; its existing application is reused. */
  create: CreateApplication & { request_id?: string; job_id?: number | null };
  update: UpdateApplication;
  move: { id: number; stage_id: number; expected_stage_id?: number };
  archive: { id: number; reason: ArchiveReason; note?: string };
  reopen: { id: number };
  details: { id: number };
  "link/options": { id: number };
  /** Link a saved job, or create one from the application's context. */
  link: { id: number; description?: string } & (
    | { job_id: number }
    | { create: true; role_title?: string; company_name?: string; external_url?: string; comp?: string }
  );
  review: Record<string, never>;
  "review/resolve": { id: number; decision: ReviewDecision; company_name?: string; external_url?: string; applied_at?: string };
  "review/reconcile": Record<string, never>;
  "stages/save": { id?: number; name: string; category?: StageCategory };
  "stages/reorder": { ids: number[] };
  "stages/set-archived": { id: number; archived: boolean };
}

/** Fields Apply needs to prepare a resume for a job. */
export type PreparationField = "role_title" | "company_name" | "external_url" | "description";

/**
 * A saved job that may be the opportunity behind an application. Matches come
 * only from the same link or LinkedIn job ID, never from company or title.
 *
 * @property application_id Application already linked to this job, which
 *   blocks another link because a job keeps a single journey.
 */
export interface JobCandidate {
  id: number;
  title: string | null;
  company_name: string | null;
  link: string | null;
  archived_at: string | null;
  match: "link" | "linkedin_id";
  application_id: number | null;
}

/** Context offered before linking: the record's data, what is missing and plausible jobs. */
export interface JobLinkOptions {
  application_id: number;
  role_title: string | null;
  company_name: string | null;
  external_url: string | null;
  comp: string | null;
  missing: PreparationField[];
  candidates: JobCandidate[];
}

/** Outcome of a link; `missing` lists data Apply still needs before generating. */
export interface JobLinkResult {
  application_id: number;
  job_id: number;
  created_job: boolean;
  missing: PreparationField[];
}

/**
 * Explicit decisions for a flagged record. Linking a job uses the `link` board
 * action; none of these merge records or change IDs.
 */
export const REVIEW_DECISIONS = ["track", "mark_submitted", "mark_not_submitted", "keep_attempt"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
/** Card data a record needs before it can enter the board. */
export type BoardField = "company_name" | "external_url" | "applied_at";

/**
 * One legacy record waiting for reconciliation.
 *
 * @property safe_fix Decision that follows deterministically from the record's
 *   origin and data; `reconcile` applies it without asking.
 * @property link_job True when the record needs (or may get) a saved job.
 * @property related Other applications for the same job, shown as a conflict.
 */
export interface ReviewItem {
  id: number;
  job_id: number | null;
  job_exists: boolean;
  origin: string;
  status: string;
  submission_status: string;
  applied_at: string | null;
  tracked: boolean;
  company_name: string | null;
  role_title: string | null;
  external_url: string | null;
  review_reason: ReviewReason;
  safe_fix: ReviewDecision | null;
  decisions: ReviewDecision[];
  link_job: boolean;
  missing: BoardField[];
  candidates: JobCandidate[];
  related: { id: number; attempt: number | null; submission_status: string }[];
}
