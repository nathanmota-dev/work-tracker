import { createHash } from "node:crypto";
import type { Database } from "../db/sqlite.ts";

/**
 * A resume the ATS score reads: a ready saved variant, the base preview of the
 * current sources, or the job's latest tailored document.
 *
 * @property key Cache key: `variant:<id>`, `base:<sourceVersion>` or `document:<versionId>`.
 * @property hash Hash of `text`; a regenerated PDF changes it.
 */
export interface ScoredDocument {
  key: string;
  kind: "variant" | "base" | "document";
  variantId: string | null;
  label: string;
  text: string;
  hash: string;
}

export const textHash = (text: string): string => createHash("sha256").update(text).digest("hex");
const scored = (key: string, kind: ScoredDocument["kind"], variantId: string | null, label: string, text: string): ScoredDocument => ({ key, kind, variantId, label, text, hash: textHash(text) });

/**
 * Ready, unarchived saved resumes with their PDF text, in the Resumes order.
 * Without any, the base preview of the current sources (`baseVersion` is only
 * called then, since it reads the LaTeX project).
 */
export function documentsToScore(d: Database, baseVersion: () => string | null): ScoredDocument[] {
  const variants = d.query(`SELECT v.id, v.name, p.text FROM resume_variants v JOIN pdf_artifacts p ON p.id = v.pdf_artifact_id
    WHERE v.status = 'ready' AND v.archived_at IS NULL ORDER BY v.role, v.created_at DESC, v.rowid DESC`).all() as { id: string; name: string; text: string }[];
  if (variants.length) return variants.map(row => scored(`variant:${row.id}`, "variant", row.id, row.name, row.text));
  const version = baseVersion();
  if (!version) return [];
  const base = d.query("SELECT text FROM pdf_artifacts WHERE source_version = ? AND run_id IS NULL AND kind = 'base' ORDER BY rowid DESC LIMIT 1").get(version) as { text: string } | undefined;
  return base ? [scored(`base:${version}`, "base", null, "Base resume", base.text)] : [];
}

/** The job's latest tailored document version; documents made from a saved resume are that resume. */
export function tailoredDocument(d: Database, jobId: number): ScoredDocument | null {
  const row = d.query(`SELECT v.id, p.text FROM document_versions v JOIN pdf_artifacts p ON p.id = v.id JOIN application_runs r ON r.id = v.run_id
    WHERE r.job_id = ? AND v.variant_id IS NULL ORDER BY v.rowid DESC LIMIT 1`).get(jobId) as { id: string; text: string } | undefined;
  return row ? scored(`document:${row.id}`, "document", null, "Tailored resume", row.text) : null;
}
