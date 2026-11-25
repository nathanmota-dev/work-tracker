import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, now } from "../db/index.ts";
import { paths } from "../paths.ts";
import { journeyRecord, latestForJob, openApplication, transition } from "../applications/journey-store.ts";
import { planTransition } from "../applications/journey.ts";
import { PreparationError } from "../preparation/sources.ts";
import { addArtifact, artifactFile, runRecord } from "../preparation/store.ts";
import { addCheckpoint } from "../preparation/recovery.ts";
import { saveVariantDocument } from "../preparation/documents.ts";
import { jobId, jobRecord } from "../preparation/jobs.ts";
import { SAVED_RESUME, type PreparationRun } from "../preparation/types.ts";
import { variantManifest, variantRecord } from "./store.ts";
import { variantId } from "./validation.ts";

/** The base PDF and its text a variant's document is compared with; an imported PDF is its own base. */
function variantBase(manifest: { manifestPath?: string; baseArtifactId?: string }, pdfPath: string, pdfText: string): { path: string; text: string } {
  const basePath = manifest.manifestPath ? join(manifest.manifestPath, "..", "base.pdf") : "";
  if (!manifest.baseArtifactId || !existsSync(basePath)) return { path: pdfPath, text: pdfText };
  try { return { path: basePath, text: artifactFile(manifest.baseArtifactId).text }; } catch { return { path: basePath, text: pdfText }; }
}

/**
 * The application's current execution when it already uses this exact saved
 * resume and is not running, so choosing the same resume again keeps one
 * execution, its approval and any portal review it requires.
 */
function reusableRun(d: ReturnType<typeof db>, applicationId: number | null, variant: { id: string; updatedAt: string }): PreparationRun | null {
  if (!applicationId) return null;
  const row = d.query("SELECT r.id, r.options_json, r.created_at FROM applications a JOIN application_runs r ON r.id = a.preparation_run_id WHERE a.id = ? AND r.provider = ? AND r.status <> 'running'")
    .get(applicationId, SAVED_RESUME) as { id: string; options_json: string; created_at: string } | undefined;
  if (!row || row.created_at < variant.updatedAt) return null;
  try { return (JSON.parse(row.options_json) as { variantId?: unknown }).variantId === variant.id ? runRecord(row.id) : null; }
  catch { return null; }
}

/**
 * Prepare an application with a saved resume, without calling the agent. The
 * run is created in review with the variant's exact PDF bytes, so approval,
 * filling and submission work as with a tailored resume. Everything changes
 * in one transaction. `assertIdle` guards the shared execution slot.
 */
export function useVariant(input: Record<string, unknown>, assertIdle: () => void): PreparationRun {
  assertIdle();
  const job = jobRecord(jobId(input.jobId));
  if (job.archived_at) throw new PreparationError("Restore this job before preparing an application.", 409);
  const variant = variantRecord(variantId(input.variantId));
  if (variant.archivedAt) throw new PreparationError("This saved resume is archived. Restore it or choose another one.", 409);
  if (variant.status !== "ready" || !variant.pdf) throw new PreparationError("This saved resume is not ready.", 409);
  const source = artifactFile(variant.pdf.id);
  const manifest = variantManifest(variant.id);
  const d = db();
  const requested = input.applicationId ? jobId(input.applicationId) : null;
  if (requested && !d.query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(requested, job.id)) throw new PreparationError("This application belongs to another job.");
  const existing = requested ?? latestForJob(d, job.id)?.id ?? null;
  const reused = existing && journeyRecord(d, existing).submission_status !== "submitted" ? reusableRun(d, existing, variant) : null;
  if (reused) return reused;
  if (existing) planTransition(journeyRecord(d, existing), "prepare.start");
  const id = randomUUID();
  const root = join(paths.artifacts, "applications", String(job.id), id);
  mkdirSync(root, { recursive: true });
  const pdfPath = join(root, "resume.pdf");
  copyFileSync(source.path, pdfPath);
  const base = variantBase(manifest, pdfPath, source.text);
  const basePath = base.path === pdfPath ? pdfPath : join(root, "base.pdf");
  if (basePath !== pdfPath) copyFileSync(base.path, basePath);
  const reportPath = join(root, "report.md");
  writeFileSync(reportPath, variant.report ?? `Saved resume "${variant.name}", imported as a ready PDF.`, { mode: 0o600 });
  const at = now();
  d.transaction(() => {
    const app = existing ? journeyRecord(d, existing) : openApplication(d, { jobId: job.id, origin: "preparation" }).record;
    if (app.submission_status === "submitted") throw new PreparationError("This application has already been submitted.", 409);
    d.query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, model, options_json, manifest_json, report, created_at, updated_at) VALUES (?, ?, ?, 'completed', 'review', ?, NULL, ?, ?, ?, ?, ?)")
      .run(id, job.id, app.id, SAVED_RESUME, JSON.stringify({ variantId: variant.id }), JSON.stringify({ manifestPath: join(root, "manifest.json"), reportPath, coverPath: "" }), variant.report, at, at);
    transition(d, app.id, "prepare.start", "api", { runId: id });
    addArtifact(id, "base", basePath, { pages: variant.pdf!.pages, text: base.text, warnings: [] });
    const pdf = addArtifact(id, "tailored", pdfPath, { pages: variant.pdf!.pages, text: source.text, warnings: variant.pdf!.warnings });
    addCheckpoint(id, "sources"); addCheckpoint(id, "tailored");
    saveVariantDocument(d, { runId: id, applicationId: app.id, pdf, job, variant, manifest, baseText: base.text });
    d.query("UPDATE applications SET external_url = COALESCE(external_url, ?), fields_filled_json = NULL, unfilled_json = NULL, resume_path = ?, report_path = ?, cover_letter_path = NULL, preparation_run_id = ? WHERE id = ?")
      .run(job.link, pdfPath, reportPath, id, app.id);
    transition(d, app.id, "prepare.complete", "api", { runId: id });
    transition(d, app.id, "fill.reset", "system", { runId: id });
    addCheckpoint(id, "compiled");
    d.query("INSERT INTO activity_log (kind, skill, summary) VALUES ('resume', 'saved-resume', ?)").run(`Used saved resume ${variant.name} for ${job.company_name} ${job.title}`);
  })();
  return runRecord(id);
}
