import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { paths } from "../paths.ts";
import { journeyRecord, latestForJob, openApplication, transition } from "../applications/journey-store.ts";
import { planTransition } from "../applications/journey.ts";
import { PreparationError } from "./sources.ts";
import { addArtifact, runRecord } from "./store.ts";
import { addCheckpoint } from "./recovery.ts";
import { jobId, jobRecord, type PreparationJob } from "./jobs.ts";
import type { PdfArtifact, PreparationRun } from "./types.ts";

/** A PDF that is already final, so an application can use it without running an agent. */
export type ReadyPdf = {
  /** Marks the execution, such as SAVED_RESUME or BASE_RESUME. */
  provider: string;
  /** What identifies this PDF; the same options reuse the application's current execution. */
  options: Record<string, unknown>;
  /** An execution created before this time used older bytes and is not reused. */
  changedAt: string;
  pdf: { path: string; text: string; pages: number; warnings: string[] };
  /** The PDF it is compared with; the same file when it is its own base. */
  base: { path: string; text: string };
  report: string | null;
  defaultReport: string;
  activity: (job: PreparationJob) => string;
  saveDocument: (d: Database, run: { runId: string; applicationId: number; pdf: PdfArtifact; job: PreparationJob; baseText: string }) => void;
};

/**
 * The application's current execution when it already uses this exact PDF and
 * is not running, so choosing it again keeps one execution, its approval and
 * any portal review it requires.
 */
function reusableRun(d: Database, applicationId: number, ready: ReadyPdf): PreparationRun | null {
  const row = d.query("SELECT r.id, r.options_json, r.created_at FROM applications a JOIN application_runs r ON r.id = a.preparation_run_id WHERE a.id = ? AND r.provider = ? AND r.status <> 'running'")
    .get(applicationId, ready.provider) as { id: string; options_json: string; created_at: string } | undefined;
  if (!row || row.created_at < ready.changedAt) return null;
  // A fill adds its agent to the options, so only the identifying keys are compared.
  try {
    const stored = JSON.parse(row.options_json) as Record<string, unknown>;
    return Object.entries(ready.options).every(([key, value]) => stored[key] === value) ? runRecord(row.id) : null;
  } catch { return null; }
}

/**
 * Prepare an application with a ready PDF, without calling the agent. The run
 * is created in review with the PDF's exact bytes, so approval, filling and
 * submission work as with a tailored resume. Everything changes in one
 * transaction. `assertIdle` guards the shared execution slot.
 */
export function useReadyPdf(input: Record<string, unknown>, assertIdle: () => void, load: (job: PreparationJob) => ReadyPdf): PreparationRun {
  assertIdle();
  const job = jobRecord(jobId(input.jobId));
  if (job.archived_at) throw new PreparationError("Restore this job before preparing an application.", 409);
  const ready = load(job);
  const d = db();
  const requested = input.applicationId ? jobId(input.applicationId) : null;
  if (requested && !d.query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(requested, job.id)) throw new PreparationError("This application belongs to another job.");
  const existing = requested ?? latestForJob(d, job.id)?.id ?? null;
  const reused = existing && journeyRecord(d, existing).submission_status !== "submitted" ? reusableRun(d, existing, ready) : null;
  if (reused) return reused;
  if (existing) planTransition(journeyRecord(d, existing), "prepare.start");
  const id = randomUUID();
  const root = join(paths.artifacts, "applications", String(job.id), id);
  mkdirSync(root, { recursive: true });
  const pdfPath = join(root, "resume.pdf");
  copyFileSync(ready.pdf.path, pdfPath);
  const basePath = ready.base.path === ready.pdf.path ? pdfPath : join(root, "base.pdf");
  if (basePath !== pdfPath) copyFileSync(ready.base.path, basePath);
  const reportPath = join(root, "report.md");
  writeFileSync(reportPath, ready.report ?? ready.defaultReport, { mode: 0o600 });
  const at = now();
  d.transaction(() => {
    const app = existing ? journeyRecord(d, existing) : openApplication(d, { jobId: job.id, origin: "preparation" }).record;
    if (app.submission_status === "submitted") throw new PreparationError("This application has already been submitted.", 409);
    d.query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, model, options_json, manifest_json, report, created_at, updated_at) VALUES (?, ?, ?, 'completed', 'review', ?, NULL, ?, ?, ?, ?, ?)")
      .run(id, job.id, app.id, ready.provider, JSON.stringify(ready.options), JSON.stringify({ manifestPath: join(root, "manifest.json"), reportPath, coverPath: "" }), ready.report, at, at);
    transition(d, app.id, "prepare.start", "api", { runId: id });
    addArtifact(id, "base", basePath, { pages: ready.pdf.pages, text: ready.base.text, warnings: [] });
    const pdf = addArtifact(id, "tailored", pdfPath, { pages: ready.pdf.pages, text: ready.pdf.text, warnings: ready.pdf.warnings });
    addCheckpoint(id, "sources"); addCheckpoint(id, "tailored");
    ready.saveDocument(d, { runId: id, applicationId: app.id, pdf, job, baseText: ready.base.text });
    d.query("UPDATE applications SET external_url = COALESCE(external_url, ?), fields_filled_json = NULL, unfilled_json = NULL, resume_path = ?, report_path = ?, cover_letter_path = NULL, preparation_run_id = ? WHERE id = ?")
      .run(job.link, pdfPath, reportPath, id, app.id);
    transition(d, app.id, "prepare.complete", "api", { runId: id });
    transition(d, app.id, "fill.reset", "system", { runId: id });
    addCheckpoint(id, "compiled");
    d.query("INSERT INTO activity_log (kind, skill, summary) VALUES ('resume', ?, ?)").run(ready.provider, ready.activity(job));
  })();
  return runRecord(id);
}
