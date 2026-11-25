import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { db, now } from "../db/index.ts";
import { paths } from "../paths.ts";
import { openChromePortal } from "../mcp/chrome.ts";
import { inspectPdf } from "./latex.ts";
import { PreparationError, snapshotSources, type SourcesSnapshot } from "./sources.ts";
import { addArtifact, artifactFile, runManifest, runOptions, runRecord, updateRun } from "./store.ts";
import { preparationDetails, sourcesState } from "./details.ts";
import { SAVED_RESUME, type PdfArtifact, type PreparationDetails, type PreparationRun, type SourcesState, type SubmissionConfirmation } from "./types.ts";
import { addCheckpoint, dropCheckpoints, markPortal } from "./recovery.ts";
import { applyFillResult, fillManifestPath, interruptStaleRuns, readFillResult, webLink, type FillManifest } from "./portal-fill.ts";
import { ensureDescription, resetProject, restoreSources, type GenerationManifest, type GenerationSources } from "./generation.ts";
import { fillAgent, type FillAgent } from "./fill-agent.ts";
import { ExecutionSlot, type PreparationAgent } from "./executor.ts";
import { basePreview, compileWithCorrection, copyBaseline, texSources, warnLength, writeProject, type Compiled } from "./pipeline.ts";
export type { PreparationAgent } from "./executor.ts";
export { readableJobDetails } from "./generation.ts";
import { journeyRecord, latestForJob, openApplication, settleExecution, startTracking, transition } from "../applications/journey-store.ts";
import { saveDocument, approvedDocument, approveDocument, freezeDocumentUse } from "./documents.ts";
import { missingForPreparation } from "../jobs/preparation.ts";
import { planTransition } from "../applications/journey.ts";
import { assertPortalFree } from "./batch-store.ts";
import { useVariant } from "../variants/apply.ts";
import { saveTailoredVariant } from "../variants/promote.ts";
import { jobId, jobRecord, savePastedDescription, type PreparationJob as Job } from "./jobs.ts";

export class PreparationService {
  private unsubscribe?: () => void;
  /** @param slot The execution shared with every other agent service; see ExecutionSlot. */
  constructor(private acp: PreparationAgent, private broadcast: (event: unknown) => void, readonly slot = new ExecutionSlot(acp)) {
    const d = db();
    d.transaction(() => interruptStaleRuns(d))();
    this.unsubscribe = acp.subscribe?.(event => {
      if (!event.runId || this.slot.activeFor("preparation") !== event.runId) return;
      const run = runRecord(String(event.runId));
      const events = [...run.events, event].slice(-500);
      updateRun(run.id, { events_json: JSON.stringify(events) });
      this.changed(run.id);
    });
  }
  get isBusy(): boolean { return this.slot.isBusy; }
  private assertIdle(): void { this.slot.assertIdle(); }
  /** Reviewing one execution's results may continue while another execution runs. */
  private assertInactive(runId: unknown): void { if (this.slot.activeId === runId) throw new PreparationError("Wait for this execution to finish first.", 409); }
  private changed(id?: string): void { this.broadcast({ type: "changed", table: "application_runs", runId: id }); }
  private phase(id: string, phase: PreparationRun["phase"]): void {
    updateRun(id, { phase }); this.broadcast({ type: "preparation-status", runId: id, phase }); this.changed(id);
  }
  async sourcesState(): Promise<SourcesState> { return sourcesState(this.isBusy); }
  async preview(): Promise<PdfArtifact> {
    this.assertIdle();
    const snapshot = snapshotSources();
    try { return await this.slot.hold("preview", "preparation", signal => { this.changed(); return basePreview(snapshot, signal); }); }
    finally { this.changed(); }
  }
  details(input: Record<string, unknown>): PreparationDetails { return preparationDetails(input, this.isBusy); }
  approve(input: Record<string, unknown>) {
    this.assertInactive(input.runId);
    const version = approveDocument(input);
    if (!version.variant) this.saveInResumes(version.id);
    this.changed(version.runId);
    return version;
  }
  /** An approved tailored resume is saved in Resumes for later jobs; a failure there never undoes the approval. */
  private saveInResumes(versionId: string): void {
    try {
      const id = saveTailoredVariant(versionId);
      if (id) this.broadcast({ type: "changed", table: "resume_variants", variantId: id });
    } catch (error) {
      db().query("INSERT INTO activity_log (kind, skill, summary) VALUES ('resume', 'saved-resume', ?)").run(`Could not save the approved resume in Resumes: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000));
    }
    this.broadcast({ type: "changed", table: "activity_log" });
  }
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
  /** Prepare the application with a saved resume variant; no agent runs. */
  useVariant(input: Record<string, unknown>): PreparationRun {
    const run = useVariant(input, () => this.assertIdle());
    for (const table of ["applications", "activity_log"]) this.broadcast({ type: "changed", table });
    this.changed(run.id);
    return run;
  }
  /** Retry from the persisted checkpoint; an unknown portal outcome needs review. */
  retry(input: Record<string, unknown>, sources?: SourcesSnapshot): PreparationRun {
    this.assertIdle();
    const run = runRecord(String(input.runId ?? ""));
    const from = run.recovery.retryFrom;
    // A saved resume can be filled again, but never regenerated.
    if (from === "filling") return this.fill({ ...input, runId: run.id });
    if (run.provider === SAVED_RESUME) throw new PreparationError("Generate a tailored version instead.", 409);
    if (!from) throw new PreparationError("This execution has nothing to retry.", 409);
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
    this.slot.start(id, "preparation", work, (error, cancelled) => this.fail(id, error, cancelled), () => this.changed(id));
    this.changed(id);
    return runRecord(id);
  }
  private fail(id: string, error: unknown, cancelled: boolean): void {
    const outcome = cancelled ? "cancelled" : "failed";
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
  private async agent(id: string, manifestPath: string, skill: string, extra: string, signal: AbortSignal, chosen?: FillAgent): Promise<boolean> {
    const { provider, model } = chosen ?? runRecord(id);
    if (await this.slot.runAgent(provider, model, skill, { runId: id, manifestPath, extra }, signal)) return true;
    updateRun(id, { status: "waiting_for_sign_in" }); this.changed(id); return false;
  }
  /** Run generation from `from`, skipping phases whose checkpoints a retry reuses. */
  private async performGeneration(id: string, job: Job, from: Exclude<PreparationRun["phase"], "review" | "filling">, extra: string, signal: AbortSignal, snapshot?: SourcesSnapshot): Promise<void> {
    const sources = snapshot ? await this.prepareSources(id, job, snapshot, signal)
      : restoreSources({ ...runManifest(id) } as unknown as GenerationManifest, runRecord(id).artifacts.find(item => item.kind === "base")?.pages);
    if (from !== "compiling") {
      sources.manifest.extra = extra; updateRun(id, { manifest_json: JSON.stringify(sources.manifest) });
      if (!snapshot) { resetProject(sources.manifest); dropCheckpoints(id, "tailored"); }
      this.phase(id, "tailoring");
      if (!await this.agent(id, sources.manifest.manifestPath, "resume-tailor", extra, signal)) return;
      addCheckpoint(id, "tailored");
    }
    const compiled = await compileWithCorrection(sources, signal, { phase: phase => this.phase(id, phase), correct: message => this.agent(id, sources.manifest.manifestPath, "resume-tailor", message, signal) });
    if (compiled) this.complete(id, job, sources, compiled);
  }
  private async prepareSources(id: string, job: Job, snapshot: SourcesSnapshot, signal: AbortSignal): Promise<GenerationSources> {
    const descriptionCheck = await ensureDescription(job);
    signal.throwIfAborted();
    const root = join(paths.artifacts, "applications", String(job.id), id);
    const { baseProject, project, profilePath } = writeProject(root, snapshot);
    const manifest = {
      runId: id, job, descriptionCheck, sourceVersion: snapshot.version, engine: snapshot.config.engine,
      project, baseProject, mainFile: snapshot.config.mainFile, profilePath,
      reportPath: join(root, "report.md"), selectionPath: join(root, "selection.json"),
      coverPath: join(root, "cover-letter.md"),
      warnings: snapshot.warnings,
    };
    const manifestPath = join(root, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    updateRun(id, { manifest_json: JSON.stringify({ ...manifest, manifestPath }) });
    const preview = await basePreview(snapshot, signal);
    const baseline = copyBaseline(preview, root);
    addArtifact(id, "base", baseline.path, { pages: preview.pages, text: baseline.text, warnings: [...new Set([...snapshot.warnings, ...preview.warnings])] });
    addCheckpoint(id, "sources");
    return { manifest: { ...manifest, manifestPath }, texFiles: texSources(snapshot), basePages: preview.pages };
  }
  /** Register the validated PDF and its application together, so a failure leaves no partial change. */
  private complete(id: string, job: Job, { manifest, basePages }: GenerationSources, { compiled, report }: Compiled): void {
    warnLength(compiled, basePages);
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
    const agent = fillAgent(run, input);
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
      if (!await this.agent(id, manifestPath, "portal-filler", String(input.extra ?? ""), signal, agent)) { markPortal(id, false); return; }
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
    const active = this.slot.activeFor("preparation");
    if (!this.slot.activeId && id && !this.acp.isRunning) {
      const waiting = runRecord(id);
      if (waiting.status === "waiting_for_sign_in") {
        this.acp.cancel();
        updateRun(id, { status: "cancelled", error: null });
        this.settle(id, "cancelled");
        this.changed(id);
        return;
      }
    }
    if (!active || (id && id !== active)) throw new PreparationError("This execution is not active.", 409);
    await this.slot.cancel();
  }
  async close(): Promise<void> {
    await this.slot.close();
    this.unsubscribe?.();
  }
}
