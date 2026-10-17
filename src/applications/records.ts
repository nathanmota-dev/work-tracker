import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import type {
  ApplicationEvent,
  ApplicationStage,
  ArchiveReason,
  TrackedApplication,
} from "./types.ts";
import { ApplicationBoardError, id } from "./validation.ts";
import { TRANSITIONS } from "./journey.ts";

type ApplicationRow = Omit<TrackedApplication, "stack"> & {
  stack_json: string | null;
};
const applicationColumns = `id, job_id, origin, attempt, submission_status, submitted_at, company_name, external_url,
  role_title, role_type, stack_json, comp, company_url, notes, applied_at, current_stage_id, tracking_status, archive_reason,
  archived_at, created_at, updated_at`;

function decodeApplication(row: ApplicationRow): TrackedApplication {
  const { stack_json, ...rest } = row;
  return { ...rest, stack: JSON.parse(stack_json ?? "[]") as string[] };
}
function decodeStage(row: ApplicationStage): ApplicationStage {
  return { ...row, is_archived: Boolean(row.is_archived) };
}
export function application(d: Database, value: unknown): TrackedApplication {
  const row = d
    .query(
      `SELECT ${applicationColumns} FROM applications WHERE id = ? AND current_stage_id IS NOT NULL`,
    )
    .get(id(value)) as ApplicationRow | undefined;
  if (!row) throw new ApplicationBoardError("Application not found.", 404);
  return decodeApplication(row);
}
export function applications(d: Database): TrackedApplication[] {
  const rows = d
    .query(
      `SELECT ${applicationColumns} FROM applications WHERE current_stage_id IS NOT NULL
      ORDER BY applied_at DESC, id DESC`,
    )
    .all() as ApplicationRow[];
  return rows.map(decodeApplication);
}
export function stage(d: Database, value: unknown): ApplicationStage {
  const row = d
    .query("SELECT * FROM application_stages WHERE id = ?")
    .get(id(value)) as ApplicationStage | undefined;
  if (!row) throw new ApplicationBoardError("Stage not found.", 404);
  return decodeStage(row);
}
export function stages(d: Database): ApplicationStage[] {
  return (
    d
      .query("SELECT * FROM application_stages ORDER BY position, id")
      .all() as ApplicationStage[]
  ).map(decodeStage);
}
export function applicationEvents(
  d: Database,
  applicationId: number,
): ApplicationEvent[] {
  return d
    .query(
      "SELECT * FROM application_events WHERE application_id = ? ORDER BY occurred_at, id",
    )
    .all(applicationId) as ApplicationEvent[];
}
/** Tracking rules come from the shared journey table (archive/reopen). */
export function requireTracking(
  record: TrackedApplication,
  action: "archive" | "reopen",
) {
  const rule = TRANSITIONS[action];
  if (!(rule.from as readonly string[]).includes(record.tracking_status))
    throw new ApplicationBoardError(rule.message, 409);
}
export function requireActive(record: TrackedApplication) {
  requireTracking(record, "archive");
}
export function event(
  d: Database,
  record: TrackedApplication,
  target: ApplicationStage,
  type: ApplicationEvent["event_type"],
  from: number | null,
  reason: ArchiveReason | null = null,
  note: string | null = null,
) {
  d.query(
    `INSERT INTO application_events
    (application_id, event_type, from_stage_id, to_stage_id, stage_name, stage_category, occurred_at, reason, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    type,
    from,
    target.id,
    target.name,
    target.category,
    now(),
    reason,
    note,
  );
}
export function nextPosition(d: Database): number {
  return (
    d
      .query(
        "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM application_stages WHERE is_archived = 0",
      )
      .get() as { position: number }
  ).position;
}
