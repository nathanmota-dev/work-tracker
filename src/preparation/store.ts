import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { relative } from "node:path";
import { db, now } from "../db/index.ts";
import { paths } from "../paths.ts";
import type { PdfCheck } from "./latex.ts";
import { PreparationError } from "./sources.ts";
import type { PdfArtifact, PreparationRun } from "./types.ts";
import { deriveRecovery, parseRecovery } from "./recovery.ts";

type StoredRun = Omit<PreparationRun, "events" | "artifacts" | "recovery"> & { events_json: string; manifest_json: string; options_json: string; recovery_json: string };
export function runRecord(id: string): PreparationRun {
  const row = db().query("SELECT * FROM application_runs WHERE id = ?").get(id) as StoredRun | undefined;
  if (!row) throw new PreparationError("Preparation run not found.", 404);
  const { events_json, manifest_json: _manifest, options_json: _options, recovery_json, ...run } = row;
  const events: Record<string, unknown>[] = JSON.parse(events_json);
  const decision = [...events].reverse().find(event => event.type === "acp-status");
  const artifacts = artifactsForRun(id);
  return { ...run, ...(run.status === "running" && decision?.status === "waiting_for_permission" ? { decisionStatus: "waiting_for_permission" as const } : {}), events, artifacts, recovery: deriveRecovery({ ...run, artifacts }, parseRecovery(recovery_json)) };
}
/** The request that started a run (provider, model, additional context). */
export function runOptions(id: string): Record<string, unknown> {
  const row = db().query("SELECT options_json FROM application_runs WHERE id = ?").get(id) as { options_json: string } | undefined;
  if (!row) throw new PreparationError("Preparation run not found.", 404);
  return JSON.parse(row.options_json);
}
export type RunManifest = { manifestPath: string; reportPath: string; coverPath: string; [key: string]: string };
export function runManifest(id: string): RunManifest {
  const row = db().query("SELECT manifest_json FROM application_runs WHERE id = ?").get(id) as { manifest_json: string } | undefined;
  if (!row) throw new PreparationError("Preparation run not found.", 404);
  return JSON.parse(row.manifest_json);
}
export function updateRun(id: string, fields: Partial<Omit<PreparationRun, "events" | "artifacts" | "recovery">> & { manifest_json?: string; events_json?: string }): void {
  const allowed = ["status", "phase", "application_id", "error", "report", "manifest_json", "events_json"];
  const keys = Object.keys(fields).filter(key => allowed.includes(key));
  if (!keys.length) return;
  db().query(`UPDATE application_runs SET ${keys.map(key => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...keys.map(key => (fields as Record<string, string | number | null>)[key] ?? null), now(), id);
}
export function addArtifact(runId: string | null, kind: PdfArtifact["kind"], path: string, check: PdfCheck, sourceVersion?: string): PdfArtifact {
  const id = randomUUID();
  db().query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json, source_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, runId, kind, path, check.pages, check.text, JSON.stringify(check.warnings), sourceVersion ?? null);
  return { id, kind, pages: check.pages, warnings: check.warnings };
}
export function artifactsForRun(runId: string): PdfArtifact[] {
  const rows = db().query("SELECT id, kind, pages, warnings_json FROM pdf_artifacts WHERE run_id = ? ORDER BY rowid").all(runId) as { id: string; kind: PdfArtifact["kind"]; pages: number; warnings_json: string }[];
  return rows.map(({ warnings_json, ...row }) => ({ ...row, warnings: JSON.parse(warnings_json) }));
}
export function artifactFile(id: string): { path: string; text: string; artifact: PdfArtifact } {
  const row = db().query("SELECT * FROM pdf_artifacts WHERE id = ?").get(id) as { id: string; kind: PdfArtifact["kind"]; path: string; pages: number; text: string; warnings_json: string } | undefined;
  if (!row) throw new PreparationError("PDF not found.", 404);
  try {
    const path = realpathSync(row.path);
    const rel = relative(realpathSync(paths.artifacts), path);
    if (!rel || rel.startsWith("..")) throw new Error();
    return { path, text: row.text, artifact: { id, kind: row.kind, pages: row.pages, warnings: JSON.parse(row.warnings_json) } };
  } catch { throw new PreparationError("The PDF is missing or outside the artifact folder.", 404); }
}
export function pdfBytes(id: string): Buffer { return readFileSync(artifactFile(id).path); }
export function cachedPreview(version: string): PdfArtifact | null {
  const row = db().query("SELECT id FROM pdf_artifacts WHERE source_version = ? AND run_id IS NULL ORDER BY rowid DESC LIMIT 1").get(version) as { id: string } | undefined;
  if (!row) return null;
  try { return artifactFile(row.id).artifact; } catch { return null; }
}
