import type { Database } from "../db/sqlite.ts";
import { archive } from "./archive.ts";
import { quietApplications, STALE_DAYS } from "./quiet.ts";
import type { QuietResolution } from "./types.ts";
import { ApplicationBoardError, id } from "./validation.ts";

function selectedIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length)
    throw new ApplicationBoardError("Select at least one application to close.");
  return [...new Set(value.map(id))];
}

/** Why a selected application is no longer closed by the sweep. */
function skipReason(d: Database, applicationId: number, unreadable: Map<number, string>): string {
  const row = d.query("SELECT tracking_status FROM applications WHERE id = ? AND current_stage_id IS NOT NULL")
    .get(applicationId) as { tracking_status: string } | undefined;
  if (!row) return "Application not found";
  if (row.tracking_status === "archived") return "Already archived";
  return unreadable.get(applicationId) ?? "No longer quiet";
}

/**
 * Close the selected quiet applications as "No response". Each ID is checked
 * again against the current scan, so an application that had activity since it
 * was listed, or was already closed, is skipped instead of archived. Repeating
 * the call therefore records no second event. Runs in one transaction.
 */
export function resolveQuiet(d: Database, input: { ids: unknown; days?: number }): QuietResolution {
  const ids = selectedIds(input.ids);
  return d.transaction(() => {
    const scan = quietApplications(d, { days: input.days ?? STALE_DAYS });
    const quiet = new Map(scan.items.map((item) => [item.id, item]));
    const unreadable = new Map(scan.skipped.map((item) => [item.id, item.reason]));
    const result: QuietResolution = { resolved: [], skipped: [] };
    for (const applicationId of ids) {
      const item = quiet.get(applicationId);
      if (!item) {
        result.skipped.push({ id: applicationId, reason: skipReason(d, applicationId, unreadable) });
        continue;
      }
      const note = `Closed by quiet sweep (${item.days_quiet} days without activity)`;
      archive(d, { id: applicationId, reason: "no_response", note });
      result.resolved.push(applicationId);
    }
    return result;
  })();
}
