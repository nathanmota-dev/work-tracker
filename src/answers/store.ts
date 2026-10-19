import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { ANSWER_CATALOG, answerLanguage, validateAnswer, type AnswerValue } from "./catalog.ts";

export interface StoredAnswer extends AnswerValue { category: string; updated_at: string }
export class AnswerError extends Error {}

export function listAnswerVariants(d: Database = db()): StoredAnswer[] {
  return d.query(`SELECT key, value, category, updated_at, 'default' AS language FROM applicant_answers
    UNION ALL SELECT v.key, v.value, a.category, v.updated_at, v.language
    FROM applicant_answer_variants v JOIN applicant_answers a ON a.key = v.key
    ORDER BY category, key, language`).all() as StoredAnswer[];
}

export function parseAnswer(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AnswerError("Provide an answer object.");
  const body = input as Record<string, unknown>;
  if (typeof body.key !== "string" || !body.key.trim()) throw new AnswerError("Enter a field key.");
  if (body.value != null && typeof body.value !== "string") throw new AnswerError("Answer must be text.");
  if (body.category !== undefined && typeof body.category !== "string") throw new AnswerError("Category must be text.");
  if (body.language !== undefined && typeof body.language !== "string") throw new AnswerError("Language must be text.");
  const key = body.key.trim();
  let language: string;
  try { language = answerLanguage(body.language as string | undefined); }
  catch (error) { throw new AnswerError((error as Error).message); }
  const value = body.value as string | null | undefined ?? null;
  const error = validateAnswer(key, value);
  if (error) throw new AnswerError(error);
  const category = ANSWER_CATALOG.find((spec) => spec.key === key)?.category ?? (body.category as string | undefined)?.trim() ?? "custom";
  return { key, value, category: category || "custom", language };
}

export function saveAnswer(input: unknown, d: Database = db()): void {
  const answer = parseAnswer(input);
  d.transaction(() => {
    d.query(`INSERT INTO applicant_answers (key, value, category, updated_at)
      VALUES ($key, $value, $cat, $at) ON CONFLICT(key) DO UPDATE SET
      value = CASE WHEN $default THEN excluded.value ELSE applicant_answers.value END,
      category = excluded.category, updated_at = excluded.updated_at`).run({
      $key: answer.key, $value: answer.language === "default" ? answer.value : null,
      $cat: answer.category, $at: now(), $default: Number(answer.language === "default"),
    });
    if (answer.language !== "default") d.query(`INSERT INTO applicant_answer_variants (key, language, value, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(key, language) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(answer.key, answer.language, answer.value, now());
  })();
}

export function deleteAnswer(input: unknown, d: Database = db()): void {
  // Deletion must also repair invalid legacy values, without validating their content.
  const { key, language } = parseAnswer({ ...(input as object), value: null });
  d.transaction(() => {
    if (language === "default") d.query("UPDATE applicant_answers SET value = NULL, updated_at = ? WHERE key = ?").run(now(), key);
    else d.query("DELETE FROM applicant_answer_variants WHERE key = ? AND language = ?").run(key, language);
    d.query(`DELETE FROM applicant_answers WHERE key = ? AND value IS NULL
      AND NOT EXISTS (SELECT 1 FROM applicant_answer_variants WHERE key = ?)`).run(key, key);
  })();
}
