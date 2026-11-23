import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_KINDS,
  FollowupError,
  MAX_FOLLOW_UPS,
  MAX_WORDS,
  MIN_WORDS,
  type FollowupChannel,
  type FollowupDraft,
  type FollowupInput,
  type FollowupKind,
} from "./types.ts";

const COLUMNS = "id, application_id, kind, channel, subject, body_md, status, stage_event_id, created_at, sent_at";

/** Words of a draft body, ignoring Markdown punctuation that stands alone. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Follow-ups of one application already marked as sent. */
export function sentFollowUps(applicationId: number, d: Database = db()): number {
  const row = d.query("SELECT COUNT(*) AS n FROM followup_drafts WHERE application_id = ? AND kind = 'follow_up' AND status = 'sent'")
    .get(applicationId) as { n: number };
  return row.n;
}

function capReached(applicationId: number): FollowupError {
  return new FollowupError(`${MAX_FOLLOW_UPS} follow-ups were already sent for application #${applicationId}; do not offer a third one.`, 409);
}

function validated(input: FollowupInput): { kind: FollowupKind; channel: FollowupChannel; body: string; subject: string | null } {
  if (!Number.isInteger(input.applicationId) || input.applicationId < 1) throw new FollowupError("application id must be a positive integer");
  if (!FOLLOWUP_KINDS.includes(input.kind as FollowupKind)) throw new FollowupError(`kind must be one of: ${FOLLOWUP_KINDS.join(", ")}`);
  if (!FOLLOWUP_CHANNELS.includes(input.channel as FollowupChannel)) throw new FollowupError(`channel must be one of: ${FOLLOWUP_CHANNELS.join(", ")}`);
  const body = input.body.trim();
  const subject = input.subject?.trim() || null;
  if (!body) throw new FollowupError("the draft is empty");
  const words = wordCount(body);
  if (words < MIN_WORDS || words > MAX_WORDS) throw new FollowupError(`the draft has ${words} words; keep it between ${MIN_WORDS} and ${MAX_WORDS}`);
  if (input.channel === "email" && !subject) throw new FollowupError("an email draft needs a subject");
  if (input.channel !== "email" && subject) throw new FollowupError(`a ${input.channel} message has no subject; leave it out`);
  if (input.stageEventId !== undefined && input.kind !== "thank_you") throw new FollowupError("only a thank-you note refers to a stage event");
  if (input.stageEventId !== undefined && (!Number.isInteger(input.stageEventId) || input.stageEventId < 1)) throw new FollowupError("stage event id must be a positive integer");
  return { kind: input.kind as FollowupKind, channel: input.channel as FollowupChannel, body, subject };
}

/**
 * Stores a draft written by the skill. A new follow-up is refused once two
 * follow-ups were sent, and a thank-you may name the stage event it answers.
 */
export function saveFollowup(input: FollowupInput, d: Database = db()): number {
  const { kind, channel, body, subject } = validated(input);
  if (!d.query("SELECT 1 FROM applications WHERE id = ?").get(input.applicationId))
    throw new FollowupError(`application #${input.applicationId} not found`, 404);
  if (kind === "follow_up" && sentFollowUps(input.applicationId, d) >= MAX_FOLLOW_UPS) throw capReached(input.applicationId);
  if (input.stageEventId !== undefined && !d.query("SELECT 1 FROM application_events WHERE id = ? AND application_id = ?").get(input.stageEventId, input.applicationId))
    throw new FollowupError(`stage event #${input.stageEventId} does not belong to application #${input.applicationId}`);
  const row = d.query(`
    INSERT INTO followup_drafts (application_id, kind, channel, subject, body_md, stage_event_id, created_at)
    VALUES ($application, $kind, $channel, $subject, $body, $event, $at)
    RETURNING id
  `).get({
    $application: input.applicationId,
    $kind: kind,
    $channel: channel,
    $subject: subject,
    $body: body,
    $event: input.stageEventId ?? null,
    $at: now(),
  }) as { id: number };
  return row.id;
}

/** Newest first; narrowed to one application when an id is given. */
export function listFollowups(applicationId?: number, d: Database = db()): FollowupDraft[] {
  if (applicationId === undefined)
    return d.query(`SELECT ${COLUMNS} FROM followup_drafts ORDER BY id DESC`).all() as unknown as FollowupDraft[];
  return d.query(`SELECT ${COLUMNS} FROM followup_drafts WHERE application_id = ? ORDER BY id DESC`).all(applicationId) as unknown as FollowupDraft[];
}

function draft(id: unknown, d: Database): FollowupDraft {
  if (!Number.isInteger(id) || (id as number) < 1) throw new FollowupError("draft id must be a positive integer");
  const row = d.query(`SELECT ${COLUMNS} FROM followup_drafts WHERE id = ?`).get(id as number) as FollowupDraft | undefined;
  if (!row) throw new FollowupError(`draft #${id} not found`, 404);
  return row;
}

/**
 * Records that the user sent a draft. Marking a sent draft again keeps its
 * first date; a discarded draft cannot be sent, and the cap applies here too.
 */
export function markFollowupSent(id: unknown, d: Database = db()): { draft: FollowupDraft; changed: boolean } {
  const current = draft(id, d);
  if (current.status === "sent") return { draft: current, changed: false };
  if (current.status === "discarded") throw new FollowupError("a discarded draft cannot be marked as sent", 409);
  if (current.kind === "follow_up" && sentFollowUps(current.application_id, d) >= MAX_FOLLOW_UPS) throw capReached(current.application_id);
  d.query("UPDATE followup_drafts SET status = 'sent', sent_at = ? WHERE id = ?").run(now(), current.id);
  return { draft: draft(current.id, d), changed: true };
}

/** Discards an unsent draft; sent messages stay on record. Discarding again is a no-op. */
export function discardFollowup(id: unknown, d: Database = db()): { draft: FollowupDraft; changed: boolean } {
  const current = draft(id, d);
  if (current.status === "discarded") return { draft: current, changed: false };
  if (current.status === "sent") throw new FollowupError("a sent message cannot be discarded", 409);
  d.query("UPDATE followup_drafts SET status = 'discarded' WHERE id = ?").run(current.id);
  return { draft: draft(current.id, d), changed: true };
}
