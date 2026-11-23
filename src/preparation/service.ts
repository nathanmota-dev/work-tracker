import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { db, now } from "../db/index.ts";
import { paths } from "../paths.ts";
import type { SessionManager, AcpRunResult } from "../acp/session.ts";
import { openChromePortal } from "../mcp/chrome.ts";
import { compileLatex, dependencyStatus, inspectPdf } from "./latex.ts";
import { PreparationError, snapshotSources, sourcesConfig, writeSnapshot, type SourcesSnapshot } from "./sources.ts";
import { addArtifact, artifactFile, cachedPreview, runManifest, runOptions, runRecord, updateRun } from "./store.ts";
import type { PdfArtifact, PreparationDetails, PreparationRun, SourcesState, SubmissionConfirmation } from "./types.ts";
import { addCheckpoint, dropCheckpoints, markPortal } from "./recovery.ts";
import { applyFillResult, fillManifestPath, interruptStaleRuns, readFillResult, webLink, type FillManifest } from "./portal-fill.ts";
import { ensureDescription, readTailoringOutput, resetProject, restoreSources, validateTailoredSources, type GenerationManifest, type GenerationSources } from "./generation.ts";
export { readableJobDetails } from "./generation.ts";
import { journeyRecord, latestForJob, openApplication, settleExecution, startTracking, transition } from "../applications/journey-store.ts";
import { saveDocument, documentsForJob, approvedDocument, approveDocument, freezeDocumentUse } from "./documents.ts";
import { fillReview } from "./fill-review.ts";
import { missingForPreparation } from "../jobs/preparation.ts";
import { planTransition } from "../applications/journey.ts";
import { assertPortalFree } from "./batch-store.ts";
import { jobId, jobRecord, savePastedDescription, type PreparationJob as Job } from "./jobs.ts";

export type PreparationAgent = Pick<SessionManager, "run" | "cancel"> & Partial<Pick<SessionManager, "subscribe" | "isRunning">>;
export class PreparationService {
  private active: { id: string; controller: AbortController } | null = null;
  private task: Promise<void> | null = null;
  private unsubscribe?: () => void;
  constructor(private acp: PreparationAgent, private broadcast: (event: unknown) => void) {
    const d = db();
    d.transaction(() => interruptStaleRuns(d))();
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
  /** Reviewing one execution's results may continue while another execution runs. */
  private assertInactive(runId: unknown): void { if (this.active?.id === runId) throw new PreparationError("Wait for this execution to finish first.", 409); }
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
    const job = jobRecord(jobId(input.jobId), true);
    const requestedApplication = input.applicationId ? jobId(input.applicationId) : null;
    if (requestedApplication && !db().query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(requestedApplication, job.id)) throw new PreparationError("Application not found for this job.", 404);
    const rows = db().query("SELECT id FROM application_runs WHERE job_id = ? AND (? IS NULL OR application_id = ?) ORDER BY created_at DESC, rowid DESC").all(job.id, requestedApplication, requestedApplication) as { id: string }[];
    const runs = rows.map(row => runRecord(row.id));
    const applicationId = input.applicationId ? jobId(input.applicationId) : runs.find(run => run.application_id)?.application_id;
    const application = applicationId ? db().query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(applicationId, job.id) as { id: number } | undefined : undefined;
    const record = application ? journeyRecord(db(), application.id) : null;
    return {
      job, runs, documents: documentsForJob(job.id, requestedApplication), fill: record ? fillReview(db(), record.id) : null, busy: this.isBusy, applicationStatus: record?.status ?? null, uploadedRunId: record?.preparation_run_id ?? null,
      journey: record && { id: record.id, origin: record.origin, attempt: record.attempt, preparation_status: record.preparation_status, fill_status: record.fill_status, submission_status: record.submission_status, submitted_at: record.submitted_at, review_reason: record.review_reason },
    };
  }
  approve(input: Record<string, unknown>) { this.assertInactive(input.runId); const version = approveDocument(input); this.changed(version.runId); return version; }
  description(input: Record<string, unknown>): void {
    this.assertIdle();
    const job = jobRecord(jobId(input.jobId));
    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (!description) throw new PreparationError("Enter the job description.");
    savePastedDescription(job.id, description);
    this.broadcast({ type: "changed", table: "jobs" });
  }
  /** `sources` lets a batch generate from the snapshot it recorded instead of the current sources. */
  generate(input: Record<string, unknown>, sources?: SourcesSnapshot): PreparationRun {
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
    const snapshot = sources ?? snapshotSources();
    if (typeof input.provider !== "string" || !input.provider) throw new PreparationError("Select an agent.");
    const id = randomUUID();
    const at = now();
    d.transaction(() => {
      d.query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, model, options_json, created_at, updated_at) VALUES (?, ?, ?, 'running', 'preparing', ?, ?, ?, ?, ?)").run(id, job.id, applicationId, input.provider as string, typeof input.model === "string" ? input.model : null, JSON.stringify(input), at, at);
      if (applicationId) transition(d, applicationId, "prepare.start", "api", { runId: id });
    })();
    return this.start(id, signal => this.performGeneration(id, job, "preparing", String(input.extra ?? ""), signal, snapshot));
  }
  /** Retry from the persisted checkpoint; an unknown portal outcome needs review. */
  retry(input: Record<string, unknown>, sources?: SourcesSnapshot): PreparationRun {
    this.assertIdle();
    const run = runRecord(String(input.runId ?? ""));
    const from = run.recovery.retryFrom;
    if (!from) throw new PreparationError("This execution has nothing to retry.", 409);
    if (from === "filling") return this.fill({ ...input, runId: run.id });
    const job = jobRecord(run.job_id);
    if (job.archived_at) throw new PreparationError("Restore this job before preparing an application.", 409);
    const d = db();
    if (run.application_id) planTransition(journeyRecord(d, run.application_id), "prepare.start");
    const snapshot = from === "preparing" ? sources ?? snapshotSources() : undefined;
    const extra = typeof input.extra === "string" && input.extra.trim() ? input.extra : String(runOptions(run.id).extra ?? "");
    d.transaction(() => {
      updateRun(run.id, { status: "running", phase: from, error: null });
      if (run.application_id) transition(d, run.application_id, "prepare.start", "api", { runId: run.id });
    })();
    return this.start(run.id, signal => this.performGeneration(run.id, job, from, extra, signal, snapshot));
  }
  private start(id: string, work: (signal: AbortSignal) => Promise<void>): PreparationRun {
    const controller = new AbortController();
    this.active = { id, controller };
    this.task = work(controller.signal).catch(error => this.fail(id, error)).finally(() => { this.active = null; this.task = null; this.changed(id); });
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
  /** Run generation from `from`, skipping phases whose checkpoints a retry reuses. */
  private async performGeneration(id: string, job: Job, from: Exclude<PreparationRun["phase"], "review" | "filling">, extra: string, signal: AbortSignal, snapshot?: SourcesSnapshot): Promise<void> {
    const sources = snapshot ? await this.prepareSources(id, job, snapshot, signal)
      : restoreSources({ ...runManifest(id) } as unknown as GenerationManifest, runRecord(id).artifacts.find(item => item.kind === "base")?.pages);
    if (from !== "compiling") {
      sources.manifest.extra = extra; updateRun(id, { manifest_json: JSON.stringify(sources.manifest) });
      if (!snapshot) { resetProject(sources.manifest); dropCheckpoints(id, "tailored"); }
      this.phase(id, "tailoring");
      if (!await this.agent(id, sources.manifest.manifestPath, "resume-tailor", extra)) return;
      addCheckpoint(id, "tailored");
    }
    const compiled = await this.compile(id, sources, signal);
    if (compiled) this.complete(id, job, sources, compiled);
  }
  private async prepareSources(id: string, job: Job, snapshot: SourcesSnapshot, signal: AbortSignal): Promise<GenerationSources> {
    const descriptionCheck = await ensureDescription(job);
    signal.throwIfAborted();
    const root = join(paths.artifacts, "applications", String(job.id), id);
    const baseProject = join(root, "base-project");
    const project = join(root, "project");
    writeSnapshot(snapshot, baseProject);
    writeSnapshot(snapshot, project);
    writeFileSync(join(root, "profile.json"), JSON.stringify(snapshot.data, null, 2), { mode: 0o600 });
    const manifest = {
      runId: id, job, descriptionCheck, sourceVersion: snapshot.version, engine: snapshot.config.engine,
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
    addCheckpoint(id, "sources");
    const texFiles = snapshot.files.filter(file => file.name.endsWith(".tex")).map(file => ({ name: file.name, text: file.bytes.toString("utf8").replaceAll("\r\n", "\n") }));
    return { manifest: { ...manifest, manifestPath }, texFiles, basePages: preview.pages };
  }
  /** Compile the tailored project, allowing one bounded agent correction. Undefined while waiting for sign-in. */
  private async compile(id: string, sources: GenerationSources, signal: AbortSignal): Promise<{ compiled: Awaited<ReturnType<typeof compileLatex>>; report: string } | undefined> {
    const { manifest } = sources;
    for (let attempt = 0; ; attempt++) {
      this.phase(id, "compiling");
      try {
        validateTailoredSources(sources);
        const compiled = await compileLatex(manifest.project, manifest.mainFile, manifest.engine, signal);
        writeFileSync(join(dirname(manifest.manifestPath), "compile.log"), compiled.log);
        return { compiled, report: readTailoringOutput(manifest) };
      } catch (error) {
        signal.throwIfAborted();
        if (attempt === 1) throw error;
        this.phase(id, "tailoring");
        if (!await this.agent(id, manifest.manifestPath, "resume-tailor", `Correct the compilation or output errors below without inventing information.\n${error instanceof Error ? error.message : String(error)}`)) return undefined;
      }
    }
  }
  /** Register the validated PDF and its application together, so a failure leaves no partial change. */
  private complete(id: string, job: Job, { manifest, basePages }: GenerationSources, { compiled, report }: { compiled: Awaited<ReturnType<typeof compileLatex>>; report: string }): void {
    if (compiled.check.pages > basePages) compiled.check.warnings.push(`The tailored resume has ${compiled.check.pages} pages; the base has ${basePages}. Review its length.`);
    const pdfPath = join(dirname(manifest.manifestPath), "resume.pdf");
    copyFileSync(compiled.path, pdfPath);
    const current = runRecord(id);
    const d = db();
    d.transaction(() => {
      // Reuses the job's latest attempt, so a retried generation never adds an application.
      const app = current.application_id ? journeyRecord(d, current.application_id) : openApplication(d, { jobId: job.id, origin: "preparation" }).record;
      if (app.submission_status === "submitted") throw new PreparationError("The application was submitted during generation. Its previous PDF is preserved.", 409);
      const pdf = addArtifact(id, "tailored", pdfPath, compiled.check);
      saveDocument(d, id, app.id, pdf, manifest);
      d.query("UPDATE applications SET external_url = COALESCE(external_url, ?), fields_filled_json = NULL, unfilled_json = NULL, resume_path = ?, report_path = ?, cover_letter_path = ?, preparation_run_id = ? WHERE id = ?").run(job.link, pdfPath, manifest.reportPath, existsSync(manifest.coverPath) ? manifest.coverPath : null, id, app.id);
      transition(d, app.id, "prepare.complete", "agent", { runId: id });
      // A new resume needs a new portal fill; the submission is untouched.
      transition(d, app.id, "fill.reset", "system", { runId: id });
      addCheckpoint(id, "compiled");
      updateRun(id, { status: "completed", phase: "review", application_id: app.id, report, error: null });
    })();
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
    if (!pdf || !run.application_id || !["completed", "waiting_for_sign_in", "failed", "cancelled", "interrupted"].includes(run.status)) throw new PreparationError("Generate a validated PDF before filling the application.");
    // Never repeat a portal action whose outcome is unknown without the candidate's review.
    if (run.recovery.reviewRequired && input.reviewed !== true) throw new PreparationError("The previous portal fill stopped without a result, so the portal may hold a partial fill. Review it in the browser, then confirm before filling again.", 409);
    const version = approvedDocument(id, input.versionId);
    const file = artifactFile(version.id);
    const d = db();
    const application = journeyRecord(d, run.application_id);
    planTransition(application, "fill.start");
    assertPortalFree(d, application.id);
    const url = webLink(application.external_url || job.link);
    const manifest = runManifest(id);
    const manifestPath = fillManifestPath(manifest.manifestPath);
    const fill: FillManifest = { versionId: version.id, pdfHash: version.pdfHash, runId: id, job: { ...job, description: version.description }, applicationId: run.application_id, pdfPath: file.path, url, resultPath: join(dirname(manifest.manifestPath), "fill-result.json"), reportPath: manifest.reportPath, coverPath: manifest.coverPath ?? null };
    rmSync(fill.resultPath, { force: true });
    writeFileSync(manifestPath, JSON.stringify(fill, null, 2), { mode: 0o600 });
    d.transaction(() => {
      transition(d, application.id, "fill.start", "api", { runId: id });
      markPortal(id, false);
      updateRun(id, { status: "running", phase: "filling", error: null });
    })();
    return this.start(id, async signal => {
      await inspectPdf(file.path, signal);
      await openChromePortal(url);
      signal.throwIfAborted();
      // From here the agent may act on the portal; a stop without a result needs review.
      markPortal(id, true);
      if (!await this.agent(id, manifestPath, "portal-filler", String(input.extra ?? ""))) { markPortal(id, false); return; }
      const result = readFillResult(fill);
      d.transaction(() => applyFillResult(d, fill, result))();
      this.broadcast({ type: "changed", table: "applications" });
    });
  }
  /**
   * Record the candidate's confirmation for the application filled by this
   * execution: submission, initial board stage, active tracking and one board
   * event change together. Repeating it returns the confirmed state unchanged.
   */
  submitted(input: Record<string, unknown>): SubmissionConfirmation {
    this.assertInactive(input.runId);
    const run = runRecord(String(input.runId ?? ""));
    const d = db();
    const result = d.transaction(() => {
      const record = run.application_id ? journeyRecord(d, run.application_id) : null;
      const filled = record?.submission_status === "submitted" || record?.fill_status === "filled";
      if (!record || record.preparation_run_id !== run.id || !filled || !run.artifacts.some(item => item.kind === "tailored"))
        throw new PreparationError("Fill and submit this application in the browser first.");
      const requested = input.applicationId === undefined || input.applicationId === null ? record.id : jobId(input.applicationId);
      if (record.job_id !== run.job_id || requested !== record.id) throw new PreparationError("This execution belongs to another application.", 409);
      freezeDocumentUse(d, record.id, run.id);
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
