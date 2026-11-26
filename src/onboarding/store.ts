import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { OPTIONAL_STEPS, type StepId } from "./types.ts";

export class OnboardingError extends Error {}

export interface OnboardingPreferences { hidden: boolean; skipped: StepId[]; completedAt: string | null; setupCompletedAt: string | null }

export function readPreferences(d: Database = db()): OnboardingPreferences {
  const row = d.query("SELECT hidden, skipped_json, completed_at, setup_completed_at FROM onboarding_state WHERE id = 1").get() as
    { hidden: number; skipped_json: string; completed_at: string | null; setup_completed_at: string | null } | undefined;
  let skipped: unknown = [];
  try { skipped = JSON.parse(row?.skipped_json ?? "[]"); } catch { /* a damaged list skips nothing */ }
  return {
    hidden: row?.hidden === 1,
    skipped: Array.isArray(skipped) ? OPTIONAL_STEPS.filter(step => skipped.includes(step)) : [],
    completedAt: row?.completed_at ?? null,
    setupCompletedAt: row?.setup_completed_at ?? null,
  };
}

/**
 * Apply a partial update: `hidden`, the complete `skipped` list, `completed`,
 * which records the first time every step was done or skipped, and
 * `setupCompleted`, which records the end of the full-screen setup once
 * `agentReady` confirms a tested agent.
 */
export function savePreferences(input: unknown, d: Database = db(), agentReady = () => false): OnboardingPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OnboardingError("Provide the checklist preferences to save.");
  const body = input as Record<string, unknown>;
  if (body.hidden !== undefined && typeof body.hidden !== "boolean") throw new OnboardingError("Choose whether the checklist is hidden.");
  if (body.completed !== undefined && body.completed !== true) throw new OnboardingError("Completion can only be recorded, not undone.");
  if (body.skipped !== undefined && (!Array.isArray(body.skipped) || !body.skipped.every(step => OPTIONAL_STEPS.includes(step as StepId))))
    throw new OnboardingError("Only the base resume step can be skipped.");
  if (body.setupCompleted !== undefined && body.setupCompleted !== true) throw new OnboardingError("Setup completion can only be recorded, not undone.");
  const current = readPreferences(d);
  const next: OnboardingPreferences = {
    hidden: body.hidden ?? current.hidden,
    skipped: body.skipped ? OPTIONAL_STEPS.filter(step => (body.skipped as unknown[]).includes(step)) : current.skipped,
    completedAt: current.completedAt ?? (body.completed ? now() : null),
    setupCompletedAt: current.setupCompletedAt,
  };
  if (body.setupCompleted && !next.setupCompletedAt) {
    if (!agentReady()) throw new OnboardingError("Test Claude Code or opencode before finishing setup.");
    next.setupCompletedAt = now();
  }
  d.query(`INSERT INTO onboarding_state (id, hidden, skipped_json, completed_at, setup_completed_at, updated_at) VALUES (1, $hidden, $skipped, $completed, $setup, $at)
    ON CONFLICT(id) DO UPDATE SET hidden = excluded.hidden, skipped_json = excluded.skipped_json,
    completed_at = excluded.completed_at, setup_completed_at = excluded.setup_completed_at, updated_at = excluded.updated_at`).run({
    $hidden: Number(next.hidden), $skipped: JSON.stringify(next.skipped), $completed: next.completedAt, $setup: next.setupCompletedAt, $at: now(),
  });
  return next;
}

/** Remember a passing diagnostic for this exact command; a failing one forgets it. */
export function recordVerification(target: string, fingerprint: string, passed: boolean, d: Database = db()): void {
  if (!passed) { d.query("DELETE FROM integration_verifications WHERE target = ?").run(target); return; }
  d.query(`INSERT INTO integration_verifications (target, fingerprint, checked_at) VALUES (?, ?, ?)
    ON CONFLICT(target) DO UPDATE SET fingerprint = excluded.fingerprint, checked_at = excluded.checked_at`).run(target, fingerprint, now());
}

export function verifiedFingerprints(d: Database = db()): Map<string, string> {
  const rows = d.query("SELECT target, fingerprint FROM integration_verifications").all() as { target: string; fingerprint: string }[];
  return new Map(rows.map(row => [row.target, row.fingerprint]));
}
