import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { parseExtraction } from "./extraction.ts";
import { gateProfile } from "./profile-store.ts";
import { buildStoredGate, parseStoredGate } from "./stored.ts";
import { GateError, type StoredGate } from "./types.ts";

export { gateUnverified, gateVerdict, parseStoredGate } from "./stored.ts";

/** The stored check of one job; null when it has none. */
export function jobGate(jobId: number, d: Database = db()): StoredGate | null {
  if (!Number.isSafeInteger(jobId) || jobId < 1) throw new GateError("job id must be a positive integer");
  const row = d.query("SELECT gate_json FROM jobs WHERE id = ?").get(jobId) as { gate_json: string | null } | undefined;
  if (!row) throw new GateError(`job #${jobId} not found`, 404);
  return parseStoredGate(row.gate_json);
}

/**
 * Validate the skill's extraction, evaluate it against the current profile and
 * store both on the job. The job itself is never removed or archived.
 */
export function saveGate(jobId: number, extraction: unknown, d: Database = db()): StoredGate {
  const parsed = parseExtraction(extraction);
  return d.transaction(() => {
    jobGate(jobId, d);
    const gate = buildStoredGate(parsed, gateProfile(d), now());
    d.query("UPDATE jobs SET gate_json = ? WHERE id = ?").run(JSON.stringify(gate), jobId);
    return gate;
  })();
}
