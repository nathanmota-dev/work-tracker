import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { db } from "../db/index.ts";
import { jobDetails } from "../mcp/search.ts";
import type { LatexEngine, PreparationDetails } from "./types.ts";
import { PreparationError } from "./sources.ts";
import { guardVerdict, saveGuardedDescription } from "../postings/description.ts";
import { NO_TEXT_VERDICT } from "../postings/guard/index.ts";

/** Paths of one generation run; persisted as the run manifest. */
export interface GenerationManifest {
  runId: string;
  project: string;
  baseProject: string;
  mainFile: string;
  engine: LatexEngine;
  reportPath: string;
  selectionPath: string;
  coverPath: string;
  manifestPath: string;
  [key: string]: unknown;
}
/**
 * Inputs every phase after source preparation needs.
 *
 * @property texFiles Original LaTeX sources the tailored project is checked against.
 * @property basePages Page count of the base PDF.
 */
export interface GenerationSources {
  manifest: GenerationManifest;
  texFiles: { name: string; text: string }[];
  basePages: number;
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
/**
 * Fetch and save a missing job description; a sign-in notice is never treated as
 * content. The agent only ever receives text cleaned by the posting guard, so a
 * description saved before the guard existed is checked here first. Returns the
 * verdict line, which the agent may quote; the stored excerpts never reach it.
 */
export async function ensureDescription(job: PreparationDetails["job"] & { linkedin_job_id?: string | null }): Promise<string> {
  const stored = db().query("SELECT description_guard_json FROM jobs WHERE id = ?").get(job.id) as { description_guard_json: string | null } | undefined;
  if (job.description && stored?.description_guard_json) return guardVerdict(stored.description_guard_json);
  if (job.description) return applyGuard(job, job.description, "Add the job description before generating a resume.");
  if (!job.linkedin_job_id) throw new PreparationError("Add the job description before generating a resume.");
  const description = readableJobDetails(await jobDetails(job.linkedin_job_id));
  if (!description.trim() || /login (?:is still in|in) progress|sign-in[^\n]*pending/i.test(description)) throw new PreparationError(UNAVAILABLE);
  return applyGuard(job, description, UNAVAILABLE);
}
const UNAVAILABLE = "The job description is unavailable. Complete LinkedIn sign-in or paste the description, then retry.";

function applyGuard(job: PreparationDetails["job"], raw: string, empty: string): string {
  const { description, guard } = saveGuardedDescription(db(), job.id, raw);
  if (!description) throw new PreparationError(`${empty} (${guard?.verdict ?? NO_TEXT_VERDICT})`);
  job.description = description;
  return guard!.verdict;
}

const normalize = (text: string) => text.replaceAll("\r\n", "\n");

/** Rebuild a run's sources from its saved snapshot so a retry skips source preparation. */
export function restoreSources(manifest: GenerationManifest, basePages: number | undefined): GenerationSources {
  if (basePages === undefined || !existsSync(manifest.baseProject)) throw new PreparationError("The saved source snapshot is missing. Generate the resume again.", 409);
  const texFiles = (readdirSync(manifest.baseProject, { recursive: true, withFileTypes: true }))
    .filter(item => item.isFile() && item.name.endsWith(".tex"))
    .map(item => {
      const path = join(item.parentPath, item.name);
      return { name: relative(manifest.baseProject, path).replaceAll("\\", "/"), text: normalize(readFileSync(path, "utf8")) };
    });
  return { manifest, texFiles, basePages };
}

/** Restore the working project to the snapshot and drop partial agent output. */
export function resetProject(manifest: GenerationManifest): void {
  rmSync(manifest.project, { recursive: true, force: true });
  cpSync(manifest.baseProject, manifest.project, { recursive: true });
  for (const path of [manifest.reportPath, manifest.selectionPath, manifest.coverPath]) rmSync(path, { force: true });
}

/** The agent may change content only: original comments and preambles must stay. */
export function validateTailoredSources(sources: GenerationSources): void {
  for (const file of sources.texFiles) {
    const generated = normalize(readFileSync(join(sources.manifest.project, file.name), "utf8"));
    const comments = file.text.split("\n").filter(line => line.trimStart().startsWith("%"));
    if (comments.some(line => !generated.split("\n").includes(line))) throw new Error(`Restore the original comments in ${file.name}; commented certifications are not active content.`);
    const boundary = file.text.indexOf("\\begin{document}");
    if (boundary >= 0 && generated.slice(0, generated.indexOf("\\begin{document}")) !== file.text.slice(0, boundary)) throw new Error(`Preserve the original preamble, formatting and fonts in ${file.name}.`);
  }
}

/** The tailoring report and selection the agent must leave before review. */
export function readTailoringOutput(manifest: GenerationManifest): string {
  if (!existsSync(manifest.reportPath) || !existsSync(manifest.selectionPath)) throw new Error("The agent must produce report.md and selection.json before review.");
  const selection: unknown = JSON.parse(readFileSync(manifest.selectionPath, "utf8"));
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new Error("The selection report must be a JSON object.");
  const report = readFileSync(manifest.reportPath, "utf8");
  if (!report.trim()) throw new Error("The tailoring report is empty.");
  return report;
}
