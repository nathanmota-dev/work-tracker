import type { ApplicationOrigin, SubmissionStatus } from "./journey.ts";

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
  create: CreateApplication & { request_id?: string };
  update: UpdateApplication;
  move: { id: number; stage_id: number; expected_stage_id?: number };
  archive: { id: number; reason: ArchiveReason; note?: string };
  reopen: { id: number };
  details: { id: number };
  "stages/save": { id?: number; name: string; category?: StageCategory };
  "stages/reorder": { ids: number[] };
  "stages/set-archived": { id: number; archived: boolean };
}
