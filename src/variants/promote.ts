import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db/index.ts";
import { paths } from "../paths.ts";
import { addArtifact, artifactFile } from "../preparation/store.ts";
import { inferVariantProfile } from "./infer.ts";
import { BASE_RESUME } from "../preparation/types.ts";
import { insertTailoredVariant, updateVariant, variantForApplication, variantRecord } from "./store.ts";

type ApprovedVersion = {
  id: string; application_id: number; variant_id: string | null; approved_at: string | null; source_version: string; snapshot_json: string;
  job_id: number; provider: string | null; model: string | null; report: string | null; title: string | null; description: string | null;
};

function approvedVersion(versionId: string): ApprovedVersion | undefined {
  return db().query(`SELECT v.id, v.application_id, v.variant_id, v.approved_at, v.source_version, v.snapshot_json, r.job_id, r.provider, r.model, r.report, j.title, j.description
    FROM document_versions v JOIN application_runs r ON r.id = v.run_id JOIN jobs j ON j.id = r.job_id WHERE v.id = ?`).get(versionId) as ApprovedVersion | undefined;
}

/** The description the resume was tailored to; the job's current one when the snapshot has none. */
function tailoredDescription(row: ApprovedVersion): string {
  try {
    const snapshot = JSON.parse(row.snapshot_json) as { description?: unknown };
    if (typeof snapshot.description === "string" && snapshot.description.trim()) return snapshot.description;
  } catch { /* A malformed snapshot falls back to the job. */ }
  return row.description ?? "";
}

/**
 * Save the approved tailored resume of an application in Resumes, so later jobs
 * with the same stack can reuse it without tailoring again. The PDF is copied
 * into the saved resume's own folder; the role and stacks are read from the job
 * (`inferVariantProfile`). One saved resume per application: approving a newer
 * version replaces its PDF and keeps the name, role and stacks the candidate
 * edited. A version made from a saved resume, or not approved, is ignored.
 * Returns the saved resume's ID, or null when nothing was saved.
 */
export function saveTailoredVariant(versionId: string): string | null {
  const row = approvedVersion(versionId);
  // The base resume used as it is is already in Resumes.
  if (!row || row.variant_id || !row.approved_at || row.provider === BASE_RESUME) return null;
  const existing = variantForApplication(row.application_id);
  if (existing && variantRecord(existing).source?.documentVersionId === row.id) return existing;
  const file = artifactFile(row.id);
  const id = existing ?? randomUUID();
  const folder = join(paths.artifacts, "variants", id, randomUUID());
  const path = join(folder, "resume.pdf");
  mkdirSync(folder, { recursive: true });
  try {
    copyFileSync(file.path, path);
    const d = db();
    d.transaction(() => {
      const pdf = addArtifact(null, "variant", path, { pages: file.artifact.pages, text: file.text, warnings: file.artifact.warnings }, row.source_version);
      const fields = { pdfArtifactId: pdf.id, documentVersionId: row.id, report: row.report, sourceVersion: row.source_version };
      // A newer approval replaces the content: its LaTeX is again the new Apply project until edited.
      if (existing) updateVariant(id, { manifest_json: "{}", pdf_artifact_id: fields.pdfArtifactId, document_version_id: fields.documentVersionId, report: fields.report, source_version: fields.sourceVersion, status: "ready", phase: "complete", error: null });
      else insertTailoredVariant(id, inferVariantProfile({ title: row.title, description: tailoredDescription(row) }), { ...fields, jobId: row.job_id, applicationId: row.application_id, provider: row.provider, model: row.model });
      d.query("INSERT INTO activity_log (kind, skill, summary) VALUES ('resume', 'saved-resume', ?)").run(`Saved tailored resume ${variantRecord(id).name}`);
    })();
    return id;
  } catch (error) {
    rmSync(existing ? folder : join(paths.artifacts, "variants", id), { recursive: true, force: true });
    throw error;
  }
}

/**
 * Save in Resumes the latest approved tailored resume of every application that
 * has none yet, including those approved before this feature existed.
 * Idempotent and best effort: a version whose PDF is missing or cannot be
 * copied is skipped, so opening the app never fails here. Returns how many were saved.
 */
export function saveApprovedTailoredResumes(): number {
  const rows = db().query(`SELECT v.id FROM document_versions v
    WHERE v.approved_at IS NOT NULL AND v.variant_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM resume_variants s WHERE s.application_id = v.application_id)
      AND v.rowid = (SELECT MAX(o.rowid) FROM document_versions o WHERE o.application_id = v.application_id AND o.approved_at IS NOT NULL AND o.variant_id IS NULL)
    ORDER BY v.rowid`).all() as { id: string }[];
  let saved = 0;
  for (const row of rows) {
    try { if (saveTailoredVariant(row.id)) saved++; } catch { /* Skipped; approving the version again retries it. */ }
  }
  return saved;
}
