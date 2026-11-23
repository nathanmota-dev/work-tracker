import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { languageKey } from "./evaluate.ts";
import { clean } from "./extraction.ts";
import { reevaluateGates } from "./stored.ts";
import { ELIGIBILITY_STATUSES, GateError, type CandidateLanguage, type Eligibility, type GateProfile } from "./types.ts";

const MAX_TEXT = 60;
const MAX_NOTES = 300;

/** Declared languages, alphabetically, and the work eligibility (null when not set). */
export function gateProfile(d: Database = db()): GateProfile {
  const languages = d.query("SELECT id, language, level, notes FROM candidate_languages ORDER BY language_key").all() as unknown as CandidateLanguage[];
  const row = d.query("SELECT eligibility FROM gate_profile WHERE id = 1").get() as { eligibility: Eligibility | null } | undefined;
  return { languages, eligibility: row?.eligibility ?? null };
}

function required(value: unknown, label: string, max: number): string {
  const text = clean(value);
  if (!text) throw new GateError(`${label} is required.`);
  if (text.length > max) throw new GateError(`${label} must be at most ${max} characters.`);
  return text;
}

function optionalId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new GateError("language id must be a positive integer");
  return id;
}

/** Apply a profile write and re-evaluate every stored check in one transaction. */
function write(d: Database, change: () => void): GateProfile {
  return d.transaction(() => {
    change();
    const profile = gateProfile(d);
    reevaluateGates(profile, d);
    return profile;
  })();
}

/**
 * Add a language, or update the one with `id`. Names are unique ignoring case
 * and spacing, so a language is declared once with one level.
 */
export function saveLanguage(input: { id?: unknown; language?: unknown; level?: unknown; notes?: unknown }, d: Database = db()): GateProfile {
  const id = optionalId(input.id);
  const language = required(input.language, "Language", MAX_TEXT);
  const level = required(input.level, "Level", MAX_TEXT);
  const notes = clean(input.notes) || null;
  if (notes && notes.length > MAX_NOTES) throw new GateError(`Notes must be at most ${MAX_NOTES} characters.`);
  const key = languageKey(language);
  return write(d, () => {
    const same = d.query("SELECT id, language FROM candidate_languages WHERE language_key = ?").get(key) as { id: number; language: string } | undefined;
    if (same && same.id !== id) throw new GateError(`${same.language} is already in your languages. Edit its level instead.`, 409);
    const at = now();
    if (id === undefined) {
      d.query("INSERT INTO candidate_languages (language, language_key, level, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(language, key, level, notes, at, at);
      return;
    }
    const result = d.query("UPDATE candidate_languages SET language = ?, language_key = ?, level = ?, notes = ?, updated_at = ? WHERE id = ?")
      .run(language, key, level, notes, at, id);
    if (!Number(result.changes)) throw new GateError(`language #${id} not found`, 404);
  });
}

/** Remove a declared language by id or by name. */
export function removeLanguage(input: { id?: unknown; language?: unknown }, d: Database = db()): GateProfile {
  const id = optionalId(input.id);
  const name = clean(input.language);
  if (id === undefined && !name) throw new GateError("Choose the language to remove.");
  return write(d, () => {
    const result = id === undefined
      ? d.query("DELETE FROM candidate_languages WHERE language_key = ?").run(languageKey(name))
      : d.query("DELETE FROM candidate_languages WHERE id = ?").run(id);
    if (!Number(result.changes)) throw new GateError(`${id === undefined ? name : `language #${id}`} is not in your languages.`, 404);
  });
}

/** Set the work eligibility; null (or "none") turns the eligibility gate off. */
export function setEligibility(value: unknown, d: Database = db()): GateProfile {
  const eligibility = value === null || value === "" || value === "none" ? null : value;
  if (eligibility !== null && !ELIGIBILITY_STATUSES.includes(eligibility as Eligibility))
    throw new GateError(`eligibility must be one of: ${ELIGIBILITY_STATUSES.join(", ")} or none`);
  return write(d, () => {
    d.query(`INSERT INTO gate_profile (id, eligibility, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET eligibility = excluded.eligibility, updated_at = excluded.updated_at`).run(eligibility as Eligibility | null, now());
  });
}
