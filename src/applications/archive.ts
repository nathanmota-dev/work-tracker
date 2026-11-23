import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { ARCHIVE_REASONS, type TrackedApplication } from "./types.ts";
import { application, event, requireActive, stage } from "./records.ts";
import { choice, optionalText, type Body } from "./validation.ts";

/** Tables an effective board change touches, broadcast to refresh the screens. */
export const trackedChanges = ["applications", "application_events"];

/**
 * Close an active application with an outcome and optional note. The last stage
 * and its history stay saved, so the board can reopen it later. Must run inside
 * the caller's transaction.
 */
export function archive(d: Database, body: Body): { value: TrackedApplication; changed: string[] } {
  const current = application(d, body.id);
  requireActive(current);
  const reason = choice(body.reason, ARCHIVE_REASONS, "archive reason");
  const note = optionalText(body.note);
  const at = now();
  d.query(
    "UPDATE applications SET tracking_status = 'archived', archive_reason = ?, archived_at = ?, updated_at = ? WHERE id = ?",
  ).run(reason, at, at, current.id);
  event(d, current, stage(d, current.current_stage_id), "archived", current.current_stage_id, reason, note);
  return { value: application(d, current.id), changed: [...trackedChanges] };
}
