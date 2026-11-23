import type { Database } from "../db/sqlite.ts";
import { evaluateGates } from "./evaluate.ts";
import type { GateExtraction, GateProfile, GateVerdict, StoredGate } from "./types.ts";

/** The stored check, or null when the job was never checked or the value is unreadable. */
export function parseStoredGate(json: unknown): StoredGate | null {
  if (typeof json !== "string" || !json) return null;
  try {
    const value = JSON.parse(json) as Partial<StoredGate> | null;
    return value && typeof value === "object" && ["pass", "flag", "fail"].includes(String(value.verdict)) && value.extraction ? value as StoredGate : null;
  } catch {
    return null;
  }
}

/** `pass`, `flag` or `fail`; `unchecked` for jobs never checked. */
export function gateVerdict(json: unknown): GateVerdict {
  return parseStoredGate(json)?.verdict ?? "unchecked";
}

/** A pass that rests on silence or on no enabled gate. */
export function gateUnverified(json: unknown): boolean {
  return parseStoredGate(json)?.unverified === true;
}

export function buildStoredGate(extraction: GateExtraction, profile: GateProfile, checkedAt: string): StoredGate {
  return { version: 1, ...evaluateGates(extraction, profile, checkedAt), extraction };
}

/**
 * Re-evaluate every stored check against a changed profile, keeping each
 * extraction and the time it was read. Returns the number of jobs updated.
 */
export function reevaluateGates(profile: GateProfile, d: Database): number {
  const rows = d.query("SELECT id, gate_json FROM jobs WHERE gate_json IS NOT NULL").all() as { id: number; gate_json: string }[];
  let changed = 0;
  for (const row of rows) {
    const current = parseStoredGate(row.gate_json);
    if (!current) continue;
    const next = JSON.stringify(buildStoredGate(current.extraction, profile, current.checked_at));
    if (next === row.gate_json) continue;
    d.query("UPDATE jobs SET gate_json = ? WHERE id = ?").run(next, row.id);
    changed++;
  }
  return changed;
}
