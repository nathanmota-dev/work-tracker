import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { artifactFile, runOptions, runRecord } from "./store.ts";
import { snapshotSources } from "./sources.ts";
import { PreparationError } from "./sources.ts";
import type { DocumentVersion, PdfArtifact } from "./types.ts";
import type { GenerationManifest } from "./generation.ts";
import type { ResumeVariant, VariantManifest } from "../variants/types.ts";

type Snapshot = Pick<DocumentVersion, "description" | "extra" | "data" | "baseText"> & Record<string, unknown>;
type StoredVersion = { id: string; run_id: string; application_id: number; pdf_hash: string; source_version: string; snapshot_json: string; created_at: string; approved_at: string | null; used_at: string | null; submitted_at: string | null; text: string };
export const pdfHash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const projectFiles = (projectDir: string, manifest: Pick<GenerationManifest, "mainFile" | "engine">) => snapshotSources({ projectDir, mainFile: manifest.mainFile, dataFile: "", engine: manifest.engine, profileDir: "" }).files.map(file => ({ name: file.name, base64: file.bytes.toString("base64") }));
/** Capture the source bytes, profile, job, report and selection alongside a validated PDF. Caller owns the transaction. */
export function saveDocument(d: Database, runId: string, applicationId: number, pdf: PdfArtifact, manifest: GenerationManifest): void {
  const files = (projectDir: string) => projectFiles(projectDir, manifest);
  const job = manifest.job as { description?: string };
  const snapshot: Snapshot = {
    description: job.description ?? "", extra: String(manifest.extra ?? runOptions(runId).extra ?? ""),
    data: JSON.parse(readFileSync(String(manifest.profilePath), "utf8")),
    baseText: artifactFile(runRecord(runId).artifacts.find(item => item.kind === "base")!.id).text,
    job, engine: manifest.engine, mainFile: manifest.mainFile,
    sources: files(manifest.baseProject), generatedSources: files(manifest.project),
    coverLetter: existsSync(manifest.coverPath) ? readFileSync(manifest.coverPath, "utf8") : null,
    report: readFileSync(manifest.reportPath, "utf8"), selection: JSON.parse(readFileSync(manifest.selectionPath, "utf8")),
  };
  d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(pdf.id, runId, applicationId, pdfHash(artifactFile(pdf.id).path), String(manifest.sourceVersion), JSON.stringify(snapshot), now());
}
/** Record the base resume, used as it is, as this run's document version. Caller owns the transaction. */
export function saveBaseDocument(d: Database, input: { runId: string; applicationId: number; pdf: PdfArtifact; job: { description?: string | null }; baseText: string; sourceVersion: string }): void {
  const snapshot: Snapshot = { description: input.job.description ?? "", extra: "", data: null, baseText: input.baseText, variant: null, job: input.job, report: "" };
  d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(input.pdf.id, input.runId, input.applicationId, pdfHash(artifactFile(input.pdf.id).path), input.sourceVersion, JSON.stringify(snapshot), now());
}
const readText = (path: unknown): string | null => typeof path === "string" && existsSync(path) ? readFileSync(path, "utf8") : null;
/**
 * Record a saved resume variant's PDF as this run's document version, with the
 * job, the variant and the inputs the variant was generated from (none for an
 * imported PDF). Caller owns the transaction.
 */
export function saveVariantDocument(d: Database, input: { runId: string; applicationId: number; pdf: PdfArtifact; job: { description?: string | null }; variant: ResumeVariant; manifest: Partial<VariantManifest>; baseText: string }): void {
  const { manifest, variant } = input;
  const generated = manifest.mainFile && manifest.engine ? manifest as Pick<GenerationManifest, "mainFile" | "engine"> : null;
  const files = (dir: string | undefined) => generated && dir && existsSync(dir) ? projectFiles(dir, generated) : [];
  const profile = readText(manifest.profilePath);
  const selection = readText(manifest.selectionPath);
  const snapshot: Snapshot = {
    description: input.job.description ?? "", extra: "", data: profile === null ? null : JSON.parse(profile), baseText: input.baseText,
    variant: { id: variant.id, name: variant.name, role: variant.role, stacks: variant.stacks },
    job: input.job, engine: manifest.engine ?? null, mainFile: manifest.mainFile ?? null,
    sources: files(manifest.baseProject), generatedSources: files(manifest.project), coverLetter: null,
    report: variant.report ?? readText(manifest.reportPath) ?? "", selection: selection === null ? null : JSON.parse(selection),
  };
  d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at, variant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.pdf.id, input.runId, input.applicationId, pdfHash(artifactFile(input.pdf.id).path), variant.sourceVersion ?? "imported", JSON.stringify(snapshot), now(), variant.id);
}
export function documentsForJob(jobId: number, applicationId: number | null): DocumentVersion[] {
  const rows = db().query(`SELECT v.*, p.text, u.used_at, u.submitted_at FROM document_versions v
    JOIN pdf_artifacts p ON p.id = v.id JOIN application_runs r ON r.id = v.run_id
    LEFT JOIN application_documents u ON u.version_id = v.id AND u.application_id = v.application_id
    WHERE r.job_id = ? AND (? IS NULL OR v.application_id = ?) ORDER BY v.rowid DESC`).all(jobId, applicationId, applicationId) as StoredVersion[];
  return rows.map(row => {
    const snapshot = JSON.parse(row.snapshot_json) as Snapshot;
    return { id: row.id, runId: row.run_id, applicationId: row.application_id, pdfHash: row.pdf_hash, sourceVersion: row.source_version, createdAt: row.created_at, approvedAt: row.approved_at, usedAt: row.used_at, submittedAt: row.submitted_at, text: row.text, baseText: snapshot.baseText, description: snapshot.description, extra: snapshot.extra, data: snapshot.data, variant: (snapshot.variant as DocumentVersion["variant"]) ?? null };
  });
}
/** Approval is for these exact bytes; a regenerated or modified PDF cannot inherit it. */
export function approvedDocument(runId: string, versionId?: unknown): DocumentVersion {
  const run = runRecord(runId);
  const version = documentsForJob(run.job_id, run.application_id).find(item => item.runId === runId);
  if (!version || !version.approvedAt) throw new PreparationError("Approve this document version before filling the application.", 409);
  if (versionId !== undefined && versionId !== version.id) throw new PreparationError("The selected document version differs from the approved PDF.", 409);
  if (pdfHash(artifactFile(version.id).path) !== version.pdfHash) throw new PreparationError("The approved PDF changed. Generate and approve a new version.", 409);
  return version;
}
export function approveDocument(input: Record<string, unknown>): DocumentVersion {
  const run = runRecord(String(input.runId ?? ""));
  if (run.status !== "completed" || run.phase !== "review") throw new PreparationError("Finish generation before approving this version.", 409);
  const version = documentsForJob(run.job_id, run.application_id).find(item => item.id === input.versionId && item.runId === run.id);
  if (!version) throw new PreparationError("Document version not found for this execution.", 404);
  const application = db().query("SELECT submission_status FROM applications WHERE id = ?").get(version.applicationId) as { submission_status: string };
  if (application.submission_status === "submitted") throw new PreparationError("This application has already been submitted.", 409);
  if (pdfHash(artifactFile(version.id).path) !== version.pdfHash) throw new PreparationError("The PDF changed. Generate a new version before approving.", 409);
  const at = now();
  db().query("UPDATE document_versions SET approved_at = COALESCE(approved_at, ?) WHERE id = ?").run(at, version.id);
  return { ...version, approvedAt: version.approvedAt ?? at };
}
/** Verify the manifest and result against persisted approval, including recovery after a restart. */
export function verifyDocumentUse(d: Database, manifest: { runId: string; applicationId: number; pdfPath: string; versionId?: unknown; pdfHash?: unknown }): void {
  const version = approvedDocument(manifest.runId, manifest.versionId);
  if (manifest.versionId !== version.id || manifest.applicationId !== version.applicationId || manifest.pdfHash !== version.pdfHash || manifest.pdfPath !== artifactFile(version.id).path) throw new PreparationError("The portal document differs from the approved version.", 409);
  // Recheck at completion: an agent must never report success after changing the PDF.
  const application = d.query("SELECT submission_status FROM applications WHERE id = ?").get(manifest.applicationId) as { submission_status: string };
  if (application.submission_status === "submitted") throw new PreparationError("This application has already been submitted.", 409);
}
/** Persist only a successful fill; an already submitted reference cannot be replaced. */
export function recordDocumentUse(d: Database, manifest: { applicationId: number; versionId?: unknown; pdfHash?: unknown }): void {
  d.query(`INSERT INTO application_documents (application_id, version_id, pdf_hash, used_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(application_id) DO UPDATE SET version_id = excluded.version_id, pdf_hash = excluded.pdf_hash, used_at = excluded.used_at WHERE application_documents.submitted_at IS NULL`)
    .run(manifest.applicationId, String(manifest.versionId), String(manifest.pdfHash), now());
}
export function freezeDocumentUse(d: Database, applicationId: number, runId: string): void {
  // Previously filled legacy applications have no approval record; preserve their existing submission flow.
  if (!documentsForJob(runRecord(runId).job_id, applicationId).some(item => item.runId === runId)) return;
  const version = approvedDocument(runId);
  // A later fill that was cancelled, or cut off by closing the app, keeps the last successful one; a failed one does not.
  if (!["completed", "cancelled", "interrupted"].includes(runRecord(runId).status)) throw new PreparationError("Fill the portal with the approved version before confirming submission.", 409);
  const usage = d.query("SELECT version_id, pdf_hash FROM application_documents WHERE application_id = ?").get(applicationId) as { version_id: string; pdf_hash: string } | undefined;
  if (usage?.version_id !== version.id || usage.pdf_hash !== version.pdfHash) throw new PreparationError("Fill the portal with the approved version before confirming submission.", 409);
  d.query("UPDATE application_documents SET submitted_at = COALESCE(submitted_at, ?) WHERE application_id = ?").run(now(), applicationId);
}
