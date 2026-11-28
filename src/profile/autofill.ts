import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { saveAnswer } from "../answers/store.ts";
import { profileSourcesState } from "./state.ts";
import type { PersonalField, PersonalKey } from "./types.ts";

/**
 * Fill answers from the profile. An empty answer is filled, and an answer that
 * still holds what the profile filled follows the profile when it changes, for
 * example after a new upload. A value the user typed is never replaced, and a
 * value this filled and the user then cleared is not filled again until the
 * profile changes it. Returns the keys it filled.
 */
export function autofillAnswers(personal: PersonalField[], d: Database = db()): PersonalKey[] {
  const filled: PersonalKey[] = [];
  for (const field of personal) {
    const current = (d.query("SELECT value FROM applicant_answers WHERE key = ?").get(field.key) as { value: string | null } | undefined)?.value?.trim();
    const previous = (d.query("SELECT value FROM answer_autofill WHERE key = ?").get(field.key) as { value: string } | undefined)?.value;
    if (current ? current !== previous || current === field.value : previous === field.value) continue;
    d.transaction(() => {
      saveAnswer({ key: field.key, value: field.value }, d);
      d.query(`INSERT INTO answer_autofill (key, source, value, applied_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET source = excluded.source, value = excluded.value, applied_at = excluded.applied_at`)
        .run(field.key, field.source, field.value, now());
    })();
    filled.push(field.key);
  }
  return filled;
}

/** Autofill from the configured sources; a source that cannot be read fills nothing. */
export function syncProfileAnswers(): PersonalKey[] {
  try { return autofillAnswers(profileSourcesState().personal); }
  catch { return []; }
}
