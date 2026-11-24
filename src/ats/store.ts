import type { Database } from "../db/sqlite.ts";
import { documentsToScore, tailoredDocument, textHash, type ScoredDocument } from "./documents.ts";
import { jobKeywords, type JobKeyword } from "./extract.ts";
import { ATS_VERSION, atsScore, type AtsBand } from "./score.ts";
import { resumeTerms } from "./vocabulary.ts";
export { documentsToScore, tailoredDocument, type ScoredDocument } from "./documents.ts";

export class AtsError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Stored = { job_id: number; document_key: string; description_hash: string; pdf_hash: string; ats_version: number };
type StoredScore = Stored & { score: number | null; band: AtsBand | null; matched_json: string; missing_json: string; required_missing_json: string };
const cell = (jobId: number, key: string) => `${jobId}\n${key}`;
const placeholders = (ids: readonly number[]) => ids.map(() => "?").join(", ");

function jobsFor(d: Database, jobIds?: readonly number[]): { id: number; description: string | null }[] {
  if (!jobIds) return d.query("SELECT id, description FROM jobs").all() as { id: number; description: string | null }[];
  return jobIds.length ? d.query(`SELECT id, description FROM jobs WHERE id IN (${placeholders(jobIds)})`).all(...jobIds) as { id: number; description: string | null }[] : [];
}

/**
 * Recompute, in one transaction, only the scores whose description, resume text
 * or ATS_VERSION changed, and drop the rows of resumes no longer scored (an
 * archived variant, the base preview once variants exist). A tailored
 * document's row is kept until that job is refreshed with a newer document.
 * Returns how many scores were computed.
 */
export function refreshScores(d: Database, documents: readonly ScoredDocument[], jobIds?: readonly number[]): number {
  const jobs = jobsFor(d, jobIds);
  const filter = jobIds ? ` WHERE job_id IN (${placeholders(jobIds)})` : "";
  const stored = new Map((d.query(`SELECT job_id, document_key, description_hash, pdf_hash, ats_version FROM ats_scores${filter}`).all(...(jobIds ?? [])) as Stored[]).map(row => [cell(row.job_id, row.document_key), row]));
  const keys = new Set(documents.map(document => document.key));
  const replacesDocument = documents.some(document => document.kind === "document");
  const removed = [...stored.values()].filter(row => !keys.has(row.document_key) && (replacesDocument || !row.document_key.startsWith("document:")));
  const terms = new Map<string, Set<string>>();
  const pending: { jobId: number; descriptionHash: string; document: ScoredDocument; keywords: () => JobKeyword[] }[] = [];
  for (const job of jobs) {
    const descriptionHash = textHash(job.description ?? "");
    let keywords: JobKeyword[] | undefined;
    for (const document of documents) {
      const row = stored.get(cell(job.id, document.key));
      if (row?.description_hash === descriptionHash && row.pdf_hash === document.hash && row.ats_version === ATS_VERSION) continue;
      pending.push({ jobId: job.id, descriptionHash, document, keywords: () => keywords ??= jobKeywords(job.description) });
    }
  }
  if (!pending.length && !removed.length) return 0;
  const at = new Date().toISOString();
  d.transaction(() => {
    const remove = d.query("DELETE FROM ats_scores WHERE job_id = ? AND document_key = ?");
    for (const row of removed) remove.run(row.job_id, row.document_key);
    const upsert = d.query(`INSERT INTO ats_scores (job_id, document_key, description_hash, pdf_hash, ats_version, score, band, matched_json, missing_json, required_missing_json, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id, document_key) DO UPDATE SET description_hash = excluded.description_hash, pdf_hash = excluded.pdf_hash,
      ats_version = excluded.ats_version, score = excluded.score, band = excluded.band, matched_json = excluded.matched_json, missing_json = excluded.missing_json,
      required_missing_json = excluded.required_missing_json, computed_at = excluded.computed_at`);
    for (const item of pending) {
      const covered = terms.get(item.document.key) ?? terms.set(item.document.key, resumeTerms(item.document.text)).get(item.document.key)!;
      const result = atsScore(item.keywords(), covered);
      upsert.run(item.jobId, item.document.key, item.descriptionHash, item.document.hash, ATS_VERSION, result.score, result.band,
        JSON.stringify(result.matched), JSON.stringify(result.missing), JSON.stringify(result.requiredMissing), at);
    }
  })();
  return pending.length;
}

/** The best saved resume of a job; `score` is null when the job names too few keywords. */
export interface BestScore { job_id: number; document_key: string; variant_id: string | null; label: string; score: number | null; band: AtsBand | null }

/** Each job's highest-scoring resume among `documents`; ties keep the Resumes order. */
export function bestByJob(d: Database, documents: readonly ScoredDocument[]): BestScore[] {
  const order = new Map(documents.map((document, index) => [document.key, index]));
  const best = new Map<number, BestScore & { index: number }>();
  for (const row of d.query("SELECT job_id, document_key, score, band FROM ats_scores ORDER BY job_id").all() as Pick<StoredScore, "job_id" | "document_key" | "score" | "band">[]) {
    const index = order.get(row.document_key);
    if (index === undefined) continue;
    const current = best.get(row.job_id);
    if (current && ((current.score ?? -1) > (row.score ?? -1) || ((current.score ?? -1) === (row.score ?? -1) && current.index < index))) continue;
    const document = documents[index]!;
    best.set(row.job_id, { job_id: row.job_id, document_key: row.document_key, variant_id: document.variantId, label: document.label, score: row.score, band: row.band, index });
  }
  return [...best.values()].map(({ index: _index, ...row }) => row);
}

/** One resume's score for a job, with the terms it covers and lacks. */
export interface DocumentScore extends Omit<BestScore, "job_id"> {
  kind: ScoredDocument["kind"];
  reason?: "too_few_keywords";
  matched: JobKeyword[];
  missing: JobKeyword[];
  requiredMissing: string[];
}

/** Every scored resume of one job, best first, and the job's keywords. */
export function scoresForJob(d: Database, jobId: number, documents: readonly ScoredDocument[]): { job_id: number; keywords: JobKeyword[]; documents: DocumentScore[] } {
  const job = d.query("SELECT description FROM jobs WHERE id = ?").get(jobId) as { description: string | null } | undefined;
  if (!job) throw new AtsError("Job not found.", 404);
  const rows = new Map((d.query("SELECT * FROM ats_scores WHERE job_id = ?").all(jobId) as StoredScore[]).map(row => [row.document_key, row]));
  const scores = documents.flatMap(document => {
    const row = rows.get(document.key);
    if (!row) return [];
    return [{
      document_key: document.key, kind: document.kind, variant_id: document.variantId, label: document.label, score: row.score, band: row.band,
      ...(row.score === null ? { reason: "too_few_keywords" as const } : {}),
      matched: JSON.parse(row.matched_json), missing: JSON.parse(row.missing_json), requiredMissing: JSON.parse(row.required_missing_json),
    }];
  });
  return { job_id: jobId, keywords: jobKeywords(job.description), documents: scores.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) };
}

/** Refresh, then each job's best saved resume. */
export function readBest(d: Database, baseVersion: () => string | null): BestScore[] {
  const documents = documentsToScore(d, baseVersion);
  refreshScores(d, documents);
  return bestByJob(d, documents);
}

/** Refresh one job, including its latest tailored document, then all of its scores. */
export function readJob(d: Database, jobId: number, baseVersion: () => string | null): ReturnType<typeof scoresForJob> {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new AtsError("Enter a valid job ID.");
  const tailored = tailoredDocument(d, jobId);
  const documents = [...documentsToScore(d, baseVersion), ...(tailored ? [tailored] : [])];
  refreshScores(d, documents, [jobId]);
  return scoresForJob(d, jobId, documents);
}
