export const FOLLOWUP_KINDS = ["follow_up", "thank_you"] as const;
export const FOLLOWUP_CHANNELS = ["email", "linkedin", "portal"] as const;
export const FOLLOWUP_STATUSES = ["draft", "sent", "discarded"] as const;

export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];
export type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number];
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

/** Follow-ups sent without a reply after which a third one is never offered. */
export const MAX_FOLLOW_UPS = 2;
/** Days without activity after which a submitted application is due a follow-up. */
export const FOLLOW_UP_DAYS = 10;
/** Days after an interview-stage move during which a thank-you note is offered. */
export const THANK_YOU_DAYS = 7;
/** Word range of a draft body, subject excluded. */
export const MIN_WORDS = 60;
export const MAX_WORDS = 120;
/** Stage categories that mean the candidate met someone from the company. */
export const INTERVIEW_CATEGORIES = ["recruiter", "technical", "assessment"] as const;

export interface FollowupDraft {
  id: number;
  application_id: number;
  kind: FollowupKind;
  channel: FollowupChannel;
  subject: string | null;
  body_md: string;
  status: FollowupStatus;
  stage_event_id: number | null;
  created_at: string;
  sent_at: string | null;
}

export interface FollowupInput {
  applicationId: number;
  kind: string;
  channel: string;
  body: string;
  subject?: string;
  stageEventId?: number;
}

/** A submitted application quiet long enough for a follow-up, below the cap. */
export interface FollowUpDue {
  id: number;
  company_name: string | null;
  role_title: string | null;
  stage_name: string;
  last_activity_at: string;
  days_quiet: number;
  sent_count: number;
  has_draft: boolean;
}

/** A recent move to an interview stage without a thank-you note yet. */
export interface ThankYouDue {
  id: number;
  company_name: string | null;
  role_title: string | null;
  stage_name: string;
  stage_event_id: number;
  occurred_at: string;
}

export interface FollowupCandidates {
  days: number;
  follow_ups: FollowUpDue[];
  thank_yous: ThankYouDue[];
}

/** A draft that cannot be stored or changed; `status` is the HTTP status to answer with. */
export class FollowupError extends Error {
  override name = "FollowupError";
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
