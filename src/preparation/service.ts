import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { db, now } from "../db/index.ts";
import { paths } from "../paths.ts";
import type { SessionManager, AcpRunResult } from "../acp/session.ts";
import { jobDetails } from "../mcp/search.ts";
import { openChromePortal } from "../mcp/chrome.ts";
import { compileLatex, dependencyStatus, inspectPdf } from "./latex.ts";
import { PreparationError, snapshotSources, sourcesConfig, writeSnapshot, type SourcesSnapshot } from "./sources.ts";
import { addArtifact, artifactFile, cachedPreview, runManifest, runRecord, updateRun } from "./store.ts";
import type { PdfArtifact, PreparationDetails, PreparationRun, SourcesState, SubmissionConfirmation } from "./types.ts";
import { journeyRecord, latestForJob, openApplication, settleExecution, startTracking, transition } from "../applications/journey-store.ts";
import { missingForPreparation } from "../jobs/preparation.ts";
import { planTransition } from "../applications/journey.ts";

export type PreparationAgent = Pick<SessionManager, "run" | "cancel"> & Partial<Pick<SessionManager, "subscribe" | "isRunning">>;
type Job = PreparationDetails["job"] & { linkedin_job_id?: string };
function jobRecord(id: number): Job {
  const row = db().query("SELECT id, title, company_name, description, link, archived_at, linkedin_job_id FROM jobs WHERE id = ?").get(id) as Job | undefined;
  if (!row) throw new PreparationError("Job not found.", 404);
  return row;
}
function jobId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new PreparationError("Select a saved job.");
  return value;
}
function webLink(value: unknown): string {
  try { const url = new URL(String(value)); if (["https:", "http:"].includes(url.protocol)) return url.href; } catch { /* invalid */ }
  throw new PreparationError("This application needs an HTTP or HTTPS portal URL.");
}
export function readableJobDetails(value: unknown): string {
  if (typeof value === "string") { try { return readableJobDetails(JSON.parse(value)); } catch { return value; } }
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  if (row.structuredContent) return readableJobDetails(row.structuredContent);
  for (const key of ["description", "job_description", "jobDescription", "details"]) if (row[key] !== undefined && row[key] !== null) return readableJobDetails(row[key]);
  if (Array.isArray(row.content)) return row.content.map(item => readableJobDetails((item as { text?: string }).text)).join("\n\n");
  return JSON.stringify(row, null, 2);
}
export class PreparationService {
  private active: { id: string; controller: AbortController } | null = null;
  private task: Promise<void> | null = null;
  private unsubscribe?: () => void;
  constructor(private acp: PreparationAgent, private broadcast: (event: unknown) => void) {
    // A process restart cannot resume an in-flight agent or compiler automatically.
    const d = db();
    d.transaction(() => {
      const running = d.query("SELECT id, application_id, phase FROM application_runs WHERE status = 'running'").all() as { id: string; application_id: number | null; phase: PreparationRun["phase"] }[];
      d.query("UPDATE application_runs SET status = 'interrupted', error = 'The app closed during this execution. Retry to continue.', updated_at = ? WHERE status = 'running'").run(now());
      for (const run of running) if (run.application_id) settleExecution(d, run.application_id, run.phase === "filling" ? "fill" : "preparation", "failed", run.id);
    })();
    this.unsubscribe = acp.subscribe?.(event => {
      if (!event.runId || this.active?.id !== event.runId) return;
      const run = runRecord(String(event.runId));
      const events = [...run.events, event].slice(-500);
      updateRun(run.id, { events_json: JSON.stringify(events) });
      this.changed(run.id);
    });
  }
  get isBusy(): boolean { return !!this.active || !!this.acp.isRunning; }
  private assertIdle(): void { if (this.isBusy) throw new PreparationError("Finish or cancel the active execution first.", 409); }
  private changed(id?: string): void { this.broadcast({ type: "changed", table: "application_runs", runId: id }); }
  private phase(id: string, phase: PreparationRun["phase"]): void {
    updateRun(id, { phase }); this.broadcast({ type: "preparation-status", runId: id, phase }); this.changed(id);
  }
  async sourcesState(): Promise<SourcesState> {
    const config = sourcesConfig();
    let preview: PdfArtifact | null = null;
    let warnings: string[] = [];
    if (config.projectDir) {
      try { const snapshot = snapshotSources(config); preview = cachedPreview(snapshot.version); warnings = snapshot.warnings; }
      catch (error) { warnings = [error instanceof Error ? error.message : String(error)]; }
    }
    return { config, preview, warnings, busy: this.isBusy, dependencies: await dependencyStatus(config.engine) };
  }
  private async buildPreview(snapshot: SourcesSnapshot, signal?: AbortSignal): Promise<PdfArtifact> {
    const cached = cachedPreview(snapshot.version);
    if (cached) return cached;
    const project = join(paths.artifacts, "base", snapshot.version, "project");
    writeSnapshot(snapshot, project);
    const result = await compileLatex(project, snapshot.config.mainFile, snapshot.config.engine, signal);
    writeFileSync(join(dirname(project), "compile.log"), result.log);
    return addArtifact(null, "base", result.path, result.check, snapshot.version);
  }
  async preview(): Promise<PdfArtifact> {
    this.assertIdle();
    const snapshot = snapshotSources();
    const controller = new AbortController();
    this.active = { id: "preview", controller };
    this.changed();
    const result = this.buildPreview(snapshot, controller.signal);
    this.task = result.then(() => {}, () => {});
    try { return await result; }
    finally { this.active = null; this.task = null; this.changed(); }
  }
  details(input: Record<string, unknown>): PreparationDetails {
    const job = jobRecord(jobId(input.jobId));
    const requestedApplication = input.applicationId ? jobId(input.applicationId) : null;
    if (requestedApplication && !db().query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(requestedApplication, job.id)) throw new PreparationError("Application not found for this job.", 404);
    const rows = db().query("SELECT id FROM application_runs WHERE job_id = ? AND (? IS NULL OR application_id = ?) ORDER BY created_at DESC, rowid DESC").all(job.id, requestedApplication, requestedApplication) as { id: string }[];
    const runs = rows.map(row => runRecord(row.id));
    const applicationId = input.applicationId ? jobId(input.applicationId) : runs.find(run => run.application_id)?.application_id;
    const application = applicationId ? db().query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(applicationId, job.id) as { id: number } | undefined : undefined;
    const record = application ? journeyRecord(db(), application.id) : null;
    return {
      job, runs, busy: this.isBusy, applicationStatus: record?.status ?? null, uploadedRunId: record?.preparation_run_id ?? null,
      journey: record && { id: record.id, origin: record.origin, attempt: record.attempt, preparation_status: record.preparation_status, fill_status: record.fill_status, submission_status: record.submission_status, submitted_at: record.submitted_at, review_reason: record.review_reason },
    };
  }
  description(input: Record<string, unknown>): void {
    this.assertIdle();
    const job = jobRecord(jobId(input.jobId));
    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (!description) throw new PreparationError("Enter the job description.");
    db().query("UPDATE jobs SET description = ? WHERE id = ?").run(description, job.id);
    this.broadcast({ type: "changed", table: "jobs" });
  }
  generate(input: Record<string, unknown>): PreparationRun {
    this.assertIdle();
    const job = jobRecord(jobId(input.jobId));
    if (job.archived_at) throw new PreparationError("Restore this job before preparing an application.", 409);
    const d = db();
    const applicationId = input.applicationId ? jobId(input.applicationId) : latestForJob(d, job.id)?.id ?? null;
    if (applicationId && !d.query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(applicationId, job.id)) throw new PreparationError("This application belongs to another job.");
    // Generating a resume never changes the submission; a submitted attempt keeps its documents.
    if (applicationId) planTransition(journeyRecord(d, applicationId), "prepare.start");
    const missing = missingForPreparation(job);
    if (missing.length) throw new PreparationError(`Missing for preparation: ${missing.join(", ")}.`);
    const snapshot = snapshotSources();
    if (typeof input.provider !== "string" || !input.provider) throw new PreparationError("Select an agent.");
    const id = randomUUID();
    const at = now();
    d.transaction(() => {
      d.query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, model, options_json, created_at, updated_at) VALUES (?, ?, ?, 'running', 'preparing', ?, ?, ?, ?, ?)").run(id, job.id, applicationId, input.provider as string, typeof input.model === "string" ? input.model : null, JSON.stringify(input), at, at);
      if (applicationId) transition(d, applicationId, "prepare.start", "api", { runId: id });
    })();
    const controller = new AbortController();
    this.active = { id, controller };
    this.task = this.performGeneration(id, job, snapshot, input, controller.signal).catch(error => this.fail(id, error)).finally(() => { this.active = null; this.task = null; this.changed(id); });
    this.changed(id);
    return runRecord(id);
  }
  private fail(id: string, error: unknown): void {
    const outcome = this.active?.controller.signal.aborted ? "cancelled" : "failed";
    updateRun(id, { status: outcome, error: (error instanceof Error ? error.message : String(error)).slice(-24000) });
    this.settle(id, outcome);
    this.changed(id);
  }
  /** Return the application's in-progress dimension to a resting state. */
  private settle(id: string, outcome: "failed" | "cancelled"): void {
    const run = runRecord(id);
    if (!run.application_id) return;
    const d = db();
    d.transaction(() => settleExecution(d, run.application_id!, run.phase === "filling" ? "fill" : "preparation", outcome, id))();
    this.broadcast({ type: "changed", table: "applications" });
  }
  private async agent(id: string, manifestPath: string, skill: string, extra = ""): Promise<boolean> {
    const run = runRecord(id);
    const result = await this.acp.run(run.provider, skill, { runId: id, manifestPath, extra }, run.model ?? undefined) as AcpRunResult | undefined;
    if (this.active?.controller.signal.aborted || result?.status === "cancelled") throw new Error("Cancelled");
    if (result?.status === "waiting_for_sign_in") { updateRun(id, { status: "waiting_for_sign_in" }); this.changed(id); return false; }
    if (result?.status === "error") throw new Error(result.message ?? "Agent execution failed.");
    return true;
  }
  private async performGeneration(id: string, job: Job, snapshot: SourcesSnapshot, input: Record<string, unknown>, signal: AbortSignal): Promise<void> {
    if (!job.description) {
      if (!job.linkedin_job_id) throw new PreparationError("Add the job description before generating a resume.");
      const description = readableJobDetails(await jobDetails(job.linkedin_job_id));
      if (!description.trim() || /login (?:is still in|in) progress|sign-in[^\n]*pending/i.test(description)) throw new PreparationError("The job description is unavailable. Complete LinkedIn sign-in or paste the description, then retry.");
      job.description = description;
      db().query("UPDATE jobs SET description = ? WHERE id = ?").run(description, job.id);
    }
    signal.throwIfAborted();
    const root = join(paths.artifacts, "applications", String(job.id), id);
    const baseProject = join(root, "base-project");
    const project = join(root, "project");
    writeSnapshot(snapshot, baseProject);
    writeSnapshot(snapshot, project);
    writeFileSync(join(root, "profile.json"), JSON.stringify(snapshot.data, null, 2), { mode: 0o600 });
    const manifest = {
      runId: id, job, sourceVersion: snapshot.version, engine: snapshot.config.engine,
      project, baseProject, mainFile: snapshot.config.mainFile, profilePath: join(root, "profile.json"),
      reportPath: join(root, "report.md"), selectionPath: join(root, "selection.json"),
      coverPath: join(root, "cover-letter.md"),
      warnings: snapshot.warnings,
    };
    const manifestPath = join(root, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    updateRun(id, { manifest_json: JSON.stringify({ ...manifest, manifestPath }) });
    const preview = await this.buildPreview(snapshot, signal);
    const baseline = artifactFile(preview.id);
    const basePath = join(root, "base.pdf");
    copyFileSync(baseline.path, basePath);
    addArtifact(id, "base", basePath, { pages: preview.pages, text: baseline.text, warnings: snapshot.warnings });
    this.phase(id, "tailoring");
    if (!await this.agent(id, manifestPath, "resume-tailor", String(input.extra ?? ""))) return;
    let compiled: Awaited<ReturnType<typeof compileLatex>> | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      this.phase(id, "compiling");
      try {
        for (const file of snapshot.files.filter(file => file.name.endsWith(".tex"))) {
          const original = file.bytes.toString("utf8").replaceAll("\r\n", "\n");
          const generated = readFileSync(join(project, file.name), "utf8").replaceAll("\r\n", "\n");
          const comments = original.split("\n").filter(line => line.trimStart().startsWith("%"));
          if (comments.some(line => !generated.split("\n").includes(line))) throw new Error(`Restore the original comments in ${file.name}; commented certifications are not active content.`);
          const boundary = original.indexOf("\\begin{document}");
          if (boundary >= 0 && generated.slice(0, generated.indexOf("\\begin{document}")) !== original.slice(0, boundary)) throw new Error(`Preserve the original preamble, formatting and fonts in ${file.name}.`);
        }
        compiled = await compileLatex(project, manifest.mainFile, manifest.engine, signal);
        writeFileSync(join(root, "compile.log"), compiled.log);
        if (!existsSync(manifest.reportPath) || !existsSync(manifest.selectionPath)) throw new Error("The agent must produce report.md and selection.json before review.");
        const selection: unknown = JSON.parse(readFileSync(manifest.selectionPath, "utf8"));
        if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new Error("The selection report must be a JSON object.");
        if (!readFileSync(manifest.reportPath, "utf8").trim()) throw new Error("The tailoring report is empty.");
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (attempt === 1) throw error;
        this.phase(id, "tailoring");
        if (!await this.agent(id, manifestPath, "resume-tailor", `Correct the compilation or output errors below without inventing information.\n${error instanceof Error ? error.message : String(error)}`)) return;
      }
    }
    if (!compiled) throw new Error("No compiled PDF was produced.");
    if (compiled.check.pages > preview.pages) compiled.check.warnings.push(`The tailored resume has ${compiled.check.pages} pages; the base has ${preview.pages}. Review its length.`);
    const pdfPath = join(root, "resume.pdf");
    copyFileSync(compiled.path, pdfPath);
    addArtifact(id, "tailored", pdfPath, compiled.check);
    const report = readFileSync(manifest.reportPath, "utf8");
    const current = runRecord(id);
    const d = db();
    const applicationId = d.transaction(() => {
      // Reuses the job's latest attempt, so a retried generation never adds an application.
      const app = current.application_id ? journeyRecord(d, current.application_id) : openApplication(d, { jobId: job.id, origin: "preparation" }).record;
      if (app.submission_status === "submitted") throw new PreparationError("The application was submitted during generation. Its previous PDF is preserved.", 409);
      d.query("UPDATE applications SET external_url = COALESCE(external_url, ?), fields_filled_json = NULL, unfilled_json = NULL, resume_path = ?, report_path = ?, cover_letter_path = ?, preparation_run_id = ? WHERE id = ?").run(job.link, pdfPath, manifest.reportPath, existsSync(manifest.coverPath) ? manifest.coverPath : null, id, app.id);
      transition(d, app.id, "prepare.complete", "agent", { runId: id });
      // A new resume needs a new portal fill; the submission is untouched.
      transition(d, app.id, "fill.reset", "system", { runId: id });
      return app.id;
    })();
    updateRun(id, { status: "completed", phase: "review", application_id: applicationId, report, error: null });
    db().query("INSERT INTO activity_log (kind, skill, summary) VALUES ('resume', 'work-tracker-resume-tailor', ?)").run(`Prepared ${job.company_name} ${job.title}`);
    this.broadcast({ type: "changed", table: "applications" });
    this.broadcast({ type: "changed", table: "activity_log" });
    this.changed(id);
  }
  fill(input: Record<string, unknown>): PreparationRun {
    this.assertIdle();
    const id = String(input.runId ?? "");
    const run = runRecord(id);
    const job = jobRecord(run.job_id);
    if (job.archived_at) throw new PreparationError("Restore this job before filling its portal.", 409);
    const pdf = run.artifacts.find(item => item.kind === "tailored");
    if (!pdf || !run.application_id || !["completed", "waiting_for_sign_in", "failed", "cancelled"].includes(run.status)) throw new PreparationError("Generate a validated PDF before filling the application.");
    const file = artifactFile(pdf.id);
    const d = db();
    const application = journeyRecord(d, run.application_id);
    planTransition(application, "fill.start");
    const url = webLink(application.external_url || job.link);
    const manifest = runManifest(id);
    const manifestPath = join(dirname(manifest.manifestPath), "fill-manifest.json");
    const resultPath = join(dirname(manifest.manifestPath), "fill-result.json");
    rmSync(resultPath, { force: true });
    writeFileSync(manifestPath, JSON.stringify({ runId: id, job, applicationId: run.application_id, pdfPath: file.path, url, resultPath }, null, 2), { mode: 0o600 });
    d.transaction(() => {
      transition(d, application.id, "fill.start", "api", { runId: id });
      updateRun(id, { status: "running", phase: "filling", error: null });
    })();
    const controller = new AbortController();
    this.active = { id, controller };
    this.task = (async () => {
      await inspectPdf(file.path, controller.signal);
      await openChromePortal(url);
      controller.signal.throwIfAborted();
      if (!await this.agent(id, manifestPath, "portal-filler", String(input.extra ?? ""))) return;
      const result = JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
      if (!result.fields || typeof result.fields !== "object" || Array.isArray(result.fields) || !Array.isArray(result.unfilled)) throw new Error("The agent did not produce a valid fill result. Review the browser and retry.");
      const finalUrl = result.externalUrl ? webLink(result.externalUrl) : url;
      d.transaction(() => {
        d.query("UPDATE applications SET fields_filled_json = ?, unfilled_json = ?, external_url = ?, portal = ?, resume_path = ?, preparation_run_id = ?, report_path = ?, cover_letter_path = ? WHERE id = ?").run(JSON.stringify(result.fields), JSON.stringify(result.unfilled), finalUrl, String(result.portal ?? "generic"), file.path, id, manifest.reportPath, manifest.coverPath && existsSync(manifest.coverPath) ? manifest.coverPath : null, application.id);
        // Filling never submits: the candidate confirms the submission separately.
        transition(d, application.id, "fill.complete", "agent", { runId: id });
        updateRun(id, { status: "completed", phase: "review" });
      })();
      this.broadcast({ type: "changed", table: "applications" });
    })().catch(error => this.fail(id, error)).finally(() => { this.active = null; this.task = null; this.changed(id); });
    this.changed(id);
    return runRecord(id);
  }
  /**
   * Record the candidate's confirmation for the application filled by this
   * execution: submission, initial board stage, active tracking and one board
   * event change together. Repeating it returns the confirmed state unchanged.
   */
  submitted(input: Record<string, unknown>): SubmissionConfirmation {
    this.assertIdle();
    const run = runRecord(String(input.runId ?? ""));
    const d = db();
    const result = d.transaction(() => {
      const record = run.application_id ? journeyRecord(d, run.application_id) : null;
      const filled = record?.submission_status === "submitted" || record?.fill_status === "filled";
      if (!record || record.preparation_run_id !== run.id || !filled || !run.artifacts.some(item => item.kind === "tailored"))
        throw new PreparationError("Fill and submit this application in the browser first.");
      const requested = input.applicationId === undefined || input.applicationId === null ? record.id : jobId(input.applicationId);
      if (record.job_id !== run.job_id || requested !== record.id) throw new PreparationError("This execution belongs to another application.", 409);
      const submitted = transition(d, record.id, "submit", "api", { runId: run.id }).changed;
      const tracked = startTracking(d, record.id);
      return { submitted, tracked, record: journeyRecord(d, record.id) };
    })();
    if (result.submitted || result.tracked) {
      this.broadcast({ type: "changed", table: "applications" });
      this.broadcast({ type: "changed", table: "application_events" });
    }
    return { alreadySubmitted: !result.submitted, applicationId: result.record.id, submittedAt: result.record.submitted_at };
  }
  async cancel(id?: string): Promise<void> {
    if (!this.active && id && !this.acp.isRunning) {
      const waiting = runRecord(id);
      if (waiting.status === "waiting_for_sign_in") {
        this.acp.cancel();
        updateRun(id, { status: "cancelled", error: null });
        this.settle(id, "cancelled");
        this.changed(id);
        return;
      }
    }
    if (!this.active || (id && id !== this.active.id)) throw new PreparationError("This execution is not active.", 409);
    this.active.controller.abort();
    this.acp.cancel();
    await this.task;
  }
  async close(): Promise<void> {
    this.active?.controller.abort();
    this.acp.cancel();
    await this.task;
    this.unsubscribe?.();
  }
}
