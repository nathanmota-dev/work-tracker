import { db } from "../db/index.ts";
import { journeyRecord } from "../applications/journey-store.ts";
import { dependencyStatus } from "./latex.ts";
import { profileEvidence } from "../profile/evidence.ts";
import { PreparationError, snapshotSources, sourcesConfig } from "./sources.ts";
import { cachedPreview, runRecord } from "./store.ts";
import { documentsForJob } from "./documents.ts";
import { fillReview } from "./fill-review.ts";
import { jobId, jobRecord } from "./jobs.ts";
import type { PdfArtifact, PreparationDetails, SourcesState } from "./types.ts";

/** The base resume: the profile file it is built from, its cached PDF and the LaTeX tools it needs. */
export async function sourcesState(busy: boolean): Promise<SourcesState> {
  const config = sourcesConfig();
  const { source } = profileEvidence(config.profileDir);
  let preview: PdfArtifact | null = null;
  let warnings: string[] = [];
  let version: string | null = null;
  if (source) {
    try { const snapshot = snapshotSources(); version = snapshot.version; preview = cachedPreview(snapshot.version); warnings = snapshot.warnings; }
    catch (error) { warnings = [error instanceof Error ? error.message : String(error)]; }
  }
  return { config, source, version, preview, warnings, busy, dependencies: await dependencyStatus(config.engine) };
}

/** A job's executions, documents and selected application, as Apply shows them. */
export function preparationDetails(input: Record<string, unknown>, busy: boolean): PreparationDetails {
  const job = jobRecord(jobId(input.jobId), true);
  const requestedApplication = input.applicationId ? jobId(input.applicationId) : null;
  if (requestedApplication && !db().query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(requestedApplication, job.id)) throw new PreparationError("Application not found for this job.", 404);
  const rows = db().query("SELECT id FROM application_runs WHERE job_id = ? AND (? IS NULL OR application_id = ?) ORDER BY created_at DESC, rowid DESC").all(job.id, requestedApplication, requestedApplication) as { id: string }[];
  const runs = rows.map(row => runRecord(row.id));
  const applicationId = input.applicationId ? jobId(input.applicationId) : runs.find(run => run.application_id)?.application_id;
  const application = applicationId ? db().query("SELECT id FROM applications WHERE id = ? AND job_id = ?").get(applicationId, job.id) as { id: number } | undefined : undefined;
  const record = application ? journeyRecord(db(), application.id) : null;
  return {
    job, runs, documents: documentsForJob(job.id, requestedApplication), fill: record ? fillReview(db(), record.id) : null, busy, applicationStatus: record?.status ?? null, uploadedRunId: record?.preparation_run_id ?? null,
    journey: record && { id: record.id, origin: record.origin, attempt: record.attempt, preparation_status: record.preparation_status, fill_status: record.fill_status, submission_status: record.submission_status, submitted_at: record.submitted_at, review_reason: record.review_reason, external_url: record.external_url },
  };
}
