import { db, now } from "../db/index.ts";
import { PreparationError } from "../preparation/sources.ts";
import type { PdfArtifact } from "../preparation/types.ts";
import type { ResumeVariant, VariantInput, VariantManifest, VariantProfile, VariantSource } from "./types.ts";

type StoredVariant = {
  id: string; name: string; role: ResumeVariant["role"]; stacks_json: string; focus: string | null; language: ResumeVariant["language"];
  origin: ResumeVariant["origin"]; status: ResumeVariant["status"]; phase: ResumeVariant["phase"]; provider: string | null; model: string | null;
  error: string | null; report: string | null; source_version: string | null; events_json: string; manifest_json: string;
  pdf_artifact_id: string | null; archived_at: string | null; created_at: string; updated_at: string;
  job_id: number | null; application_id: number | null; document_version_id: string | null; source_company: string | null; source_title: string | null;
};
/** Columns `updateVariant` may change. */
export type VariantChange = Partial<Pick<StoredVariant, "name" | "role" | "stacks_json" | "status" | "phase" | "provider" | "model" | "error" | "report" | "source_version" | "events_json" | "manifest_json" | "pdf_artifact_id" | "archived_at" | "document_version_id">>;
const CHANGEABLE: (keyof VariantChange)[] = ["name", "role", "stacks_json", "status", "phase", "provider", "model", "error", "report", "source_version", "events_json", "manifest_json", "pdf_artifact_id", "archived_at", "document_version_id"];
/** Variants with the company and title of the job a tailored one came from. */
const SELECT = "SELECT v.*, j.company_name AS source_company, j.title AS source_title FROM resume_variants v LEFT JOIN jobs j ON j.id = v.job_id";

function artifact(id: string | null): PdfArtifact | null {
  if (!id) return null;
  const row = db().query("SELECT id, kind, pages, warnings_json FROM pdf_artifacts WHERE id = ?").get(id) as { id: string; kind: PdfArtifact["kind"]; pages: number; warnings_json: string } | undefined;
  return row ? { id: row.id, kind: row.kind, pages: row.pages, warnings: JSON.parse(row.warnings_json) } : null;
}

function source(row: StoredVariant): VariantSource | null {
  if (row.job_id === null || row.application_id === null) return null;
  return { jobId: row.job_id, applicationId: row.application_id, documentVersionId: row.document_version_id, company: row.source_company, title: row.source_title };
}

function toVariant(row: StoredVariant, currentVersion: string | null): ResumeVariant {
  return {
    id: row.id, name: row.name, role: row.role, stacks: JSON.parse(row.stacks_json), focus: row.focus, language: row.language, origin: row.origin,
    status: row.status, phase: row.phase, provider: row.provider, model: row.model, error: row.error, report: row.report, sourceVersion: row.source_version,
    events: JSON.parse(row.events_json), pdf: artifact(row.pdf_artifact_id), archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
    stale: row.origin === "generated" && !!row.source_version && !!currentVersion && row.source_version !== currentVersion,
    source: source(row), match: null,
  };
}

/** Add a variant; generated ones start `generating`, imported ones are `ready` with their PDF. */
export function insertVariant(id: string, input: VariantProfile & Partial<Pick<VariantInput, "focus" | "language" | "provider" | "model">>, origin: ResumeVariant["origin"], pdfArtifactId: string | null = null): void {
  const at = now();
  db().query(`INSERT INTO resume_variants (id, name, role, stacks_json, focus, language, origin, status, phase, provider, model, pdf_artifact_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.name, input.role, JSON.stringify(input.stacks), input.focus ?? null, input.language ?? "auto", origin,
    origin === "imported" ? "ready" : "generating", origin === "imported" ? "complete" : "preparing", input.provider ?? null, input.model ?? null, pdfArtifactId, at, at);
}

/**
 * Add a ready variant copied from the approved tailored resume of an
 * application. It is `generated`: an agent tailored it from the sources.
 */
export function insertTailoredVariant(id: string, profile: VariantProfile, origin: { jobId: number; applicationId: number; documentVersionId: string; pdfArtifactId: string; provider: string | null; model: string | null; report: string | null; sourceVersion: string | null }): void {
  const at = now();
  db().query(`INSERT INTO resume_variants (id, name, role, stacks_json, origin, status, phase, provider, model, report, source_version, pdf_artifact_id, job_id, application_id, document_version_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'generated', 'ready', 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, profile.name, profile.role, JSON.stringify(profile.stacks), origin.provider, origin.model, origin.report,
    origin.sourceVersion, origin.pdfArtifactId, origin.jobId, origin.applicationId, origin.documentVersionId, at, at);
}

/** The saved resume copied from an application's tailored resume, if any. */
export function variantForApplication(applicationId: number): string | null {
  const row = db().query("SELECT id FROM resume_variants WHERE application_id = ?").get(applicationId) as { id: string } | undefined;
  return row?.id ?? null;
}

/** One variant; `currentVersion` is the current sources' version, used for `stale`. */
export function variantRecord(id: string, currentVersion: string | null = null): ResumeVariant {
  const row = db().query(`${SELECT} WHERE v.id = ?`).get(id) as StoredVariant | undefined;
  if (!row) throw new PreparationError("Saved resume not found.", 404);
  return toVariant(row, currentVersion);
}

/** Variants by role, newest first; archived ones only on request. */
export function listVariants(options: { includeArchived?: boolean; currentVersion?: string | null } = {}): ResumeVariant[] {
  const rows = db().query(`${SELECT} WHERE (? = 1 OR v.archived_at IS NULL) ORDER BY v.role, v.created_at DESC, v.rowid DESC`).all(options.includeArchived ? 1 : 0) as StoredVariant[];
  return rows.map(row => toVariant(row, options.currentVersion ?? null));
}

export function variantManifest(id: string): Partial<VariantManifest> {
  const row = db().query("SELECT manifest_json FROM resume_variants WHERE id = ?").get(id) as { manifest_json: string } | undefined;
  if (!row) throw new PreparationError("Saved resume not found.", 404);
  return JSON.parse(row.manifest_json);
}

export function updateVariant(id: string, fields: VariantChange): void {
  const keys = (Object.keys(fields) as (keyof VariantChange)[]).filter(key => CHANGEABLE.includes(key));
  if (!keys.length) return;
  db().query(`UPDATE resume_variants SET ${keys.map(key => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...keys.map(key => fields[key] ?? null), now(), id);
}

/** Archiving keeps the row and its PDFs: documents that used them still point there. */
export function archiveVariant(id: string): void {
  db().query("UPDATE resume_variants SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?").run(now(), now(), id);
}

export const VARIANT_CLOSED_MESSAGE = "The app closed during this generation. Regenerate the resume to try again.";
/** A restart cannot resume an in-flight agent or compiler: mark those generations interrupted. */
export function interruptStaleVariants(): void {
  db().query("UPDATE resume_variants SET status = 'interrupted', error = ?, updated_at = ? WHERE status IN ('generating', 'waiting_for_sign_in')").run(VARIANT_CLOSED_MESSAGE, now());
}
