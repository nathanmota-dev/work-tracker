import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { insertJob, memoryDatabase } from "../test/memory-db.ts";
import { artifactFile } from "../preparation/store.ts";
import { documentsForJob, pdfHash } from "../preparation/documents.ts";
import { insertVariant, updateVariant } from "./store.ts";
import { useVariant } from "./apply.ts";

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs")>()), ...Object.fromEntries(["mkdirSync", "copyFileSync", "writeFileSync", "existsSync", "readFileSync"].map(name => [name, vi.fn()])) }));
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-24T12:00:00.000Z" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
vi.mock("../preparation/store.ts", async original => ({ ...(await original<typeof import("../preparation/store.ts")>()), artifactFile: vi.fn() }));

let d: Database;
let job: number;
const variantId = "123e4567-e89b-12d3-a456-426614174000";
const idle = vi.fn();
const files: Record<string, string> = {};
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  job = insertJob(d, { description: "C# role" });
  d.exec("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json, source_version) VALUES ('variant-pdf', NULL, 'variant', '/artifacts/variants/v/g/resume.pdf', 1, 'C# resume', '[]', 'v1'), ('base-pdf', NULL, 'base', '/artifacts/base/v1/resume.pdf', 1, 'Base text', '[]', 'v1')");
  insertVariant(variantId, { name: "Back-End · C#", role: "backend", stacks: ["C#"], provider: "opencode" }, "generated");
  updateVariant(variantId, { status: "ready", pdf_artifact_id: "variant-pdf", report: "Report", source_version: "v1", manifest_json: JSON.stringify({ manifestPath: "/artifacts/variants/v/g/manifest.json", baseArtifactId: "base-pdf", mainFile: "resume.tex", engine: "pdflatex", profilePath: "/artifacts/variants/v/g/profile.json", selectionPath: "/artifacts/variants/v/g/selection.json" }) });
  for (const key of Object.keys(files)) delete files[key];
  files["/artifacts/variants/v/g/resume.pdf"] = "%PDF-variant";
  vi.mocked(fs.copyFileSync).mockImplementation((from, to) => { files[String(to)] = files[String(from)] ?? "%PDF-base"; });
  vi.mocked(fs.existsSync).mockImplementation(path => String(path).endsWith("base.pdf") || String(path).endsWith(".json"));
  vi.mocked(fs.readFileSync).mockImplementation(path => String(path).endsWith(".pdf") ? Buffer.from(files[String(path)] ?? "") : String(path).endsWith("profile.json") ? '{"skills":["C#"]}' : '{"target":{"role":"backend"}}');
  vi.mocked(artifactFile).mockImplementation(id => ({ path: id === "variant-pdf" ? "/artifacts/variants/v/g/resume.pdf" : id === "base-pdf" ? "/artifacts/base/v1/resume.pdf" : files[`/artifacts/applications/${job}/${id}`] ?? Object.keys(files).find(path => path.endsWith("resume.pdf") && path.startsWith("/artifacts/applications"))!, text: id === "base-pdf" ? "Base text" : "C# resume", artifact: { id, kind: "variant", pages: 1, warnings: [] } }));
});

test("prepares the application with the variant's exact bytes, in review, without an agent", () => {
  const run = useVariant({ jobId: job, variantId }, idle);
  expect(idle).toHaveBeenCalled();
  expect(run).toMatchObject({ provider: "saved-resume", model: null, status: "completed", phase: "review", report: "Report", recovery: { checkpoints: ["sources", "tailored", "compiled"], retryFrom: null } });
  expect(run.artifacts.map(item => item.kind)).toEqual(["base", "tailored"]);
  const pdfPath = `/artifacts/applications/${job}/${run.id}/resume.pdf`;
  expect(files[pdfPath]).toBe("%PDF-variant");
  expect(d.query("SELECT preparation_status, fill_status, resume_path, preparation_run_id, report_path FROM applications WHERE id = ?").get(run.application_id)).toEqual({ preparation_status: "ready", fill_status: "not_started", resume_path: pdfPath, preparation_run_id: run.id, report_path: `/artifacts/applications/${job}/${run.id}/report.md` });
  const [version] = documentsForJob(job, run.application_id);
  expect(version).toMatchObject({ runId: run.id, baseText: "Base text", description: "C# role", extra: "", data: { skills: ["C#"] }, sourceVersion: "v1", variant: { id: variantId, name: "Back-End · C#", role: "backend", stacks: ["C#"] } });
  expect(version!.pdfHash).toBe(pdfHash("/artifacts/variants/v/g/resume.pdf"));
  expect(d.query("SELECT variant_id FROM document_versions").get()).toEqual({ variant_id: variantId });
  expect(d.query("SELECT options_json FROM application_runs").get()).toEqual({ options_json: JSON.stringify({ variantId }) });
  expect(d.query("SELECT summary FROM activity_log").get()).toEqual({ summary: "Used saved resume Back-End · C# for Example Corp Engineer" });
  // A second use reuses the same application as a new execution.
  expect(useVariant({ jobId: job, applicationId: run.application_id, variantId }, idle).application_id).toBe(run.application_id);
});

test("an imported variant is its own base", () => {
  updateVariant(variantId, { manifest_json: "{}", report: null, source_version: null });
  const run = useVariant({ jobId: job, variantId }, idle);
  expect(documentsForJob(job, run.application_id)[0]).toMatchObject({ baseText: "C# resume", sourceVersion: "imported", data: null });
  expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/report\.md$/), 'Saved resume "Back-End · C#", imported as a ready PDF.', { mode: 0o600 });
});

test("refuses archived, unfinished and submitted cases, and a busy slot", () => {
  expect(() => useVariant({ jobId: job, variantId }, () => { throw new Error("busy"); })).toThrow("busy");
  const other = insertJob(d);
  d.exec(`INSERT INTO applications (job_id, status) VALUES (${other}, 'draft')`);
  expect(() => useVariant({ jobId: job, applicationId: 1, variantId }, idle)).toThrow("belongs to another job");
  d.exec(`UPDATE jobs SET archived_at = 'now' WHERE id = ${job}`);
  expect(() => useVariant({ jobId: job, variantId }, idle)).toThrow("Restore this job");
  d.exec(`UPDATE jobs SET archived_at = NULL WHERE id = ${job}`);
  updateVariant(variantId, { status: "failed" });
  expect(() => useVariant({ jobId: job, variantId }, idle)).toThrow("not ready");
  updateVariant(variantId, { status: "ready", archived_at: "now" });
  expect(() => useVariant({ jobId: job, variantId }, idle)).toThrow("archived");
  updateVariant(variantId, { archived_at: null });
  const run = useVariant({ jobId: job, variantId }, idle);
  d.exec(`UPDATE applications SET submission_status = 'submitted' WHERE id = ${run.application_id}`);
  expect(() => useVariant({ jobId: job, variantId }, idle)).toThrow();
  expect(d.query("SELECT COUNT(*) AS n FROM application_runs").get()).toEqual({ n: 1 });
});
