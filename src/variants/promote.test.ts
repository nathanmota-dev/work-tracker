import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { paths } from "../paths.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { PreparationError } from "../preparation/sources.ts";
import { artifactFile } from "../preparation/store.ts";
import { listVariants, updateVariant, variantRecord } from "./store.ts";
import { saveApprovedTailoredResumes, saveTailoredVariant } from "./promote.ts";

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs")>()), ...Object.fromEntries(["mkdirSync", "copyFileSync", "rmSync"].map(name => [name, vi.fn()])) }));
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-24T12:00:00.000Z" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
vi.mock("../preparation/store.ts", async original => ({ ...(await original<typeof import("../preparation/store.ts")>()), artifactFile: vi.fn() }));

/** The artifact folder in memory: path → bytes. */
const files = new Map<string, string>();
const existsSync = (path: string) => [...files.keys()].some(file => file === path || file.startsWith(`${path}/`));
const readFileSync = (path: string) => files.get(path);
const rmSync = (path: string) => { for (const file of [...files.keys()]) if (file === path || file.startsWith(`${path}/`)) files.delete(file); };

let d: Database;
let job: number;
let application: number;
const description = "Requisitos: C#, .NET e Angular";

/** A tailored run of `application` with its PDF and document version; approved unless told otherwise. */
function tailored(runId: string, fields: { approved?: boolean; variantId?: string | null; bytes?: string } = {}): string {
  const folder = join(paths.artifacts, "applications", String(job), runId);
  files.set(join(folder, "resume.pdf"), fields.bytes ?? `%PDF-${runId}`);
  d.query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, model, report, created_at, updated_at) VALUES (?, ?, ?, 'completed', 'review', 'opencode', 'm1', 'Report', 'now', 'now')").run(runId, job, application);
  const pdf = `pdf-${runId}`;
  d.query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES (?, ?, 'tailored', ?, 1, 'C# .NET Angular resume', '[\"Long\"]')").run(pdf, runId, join(folder, "resume.pdf"));
  d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at, approved_at, variant_id) VALUES (?, ?, ?, 'h', 's1', ?, 'now', ?, ?)")
    .run(pdf, runId, application, JSON.stringify({ description }), fields.approved === false ? null : "now", fields.variantId ?? null);
  return pdf;
}

beforeEach(async () => {
  files.clear();
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.copyFileSync).mockImplementation((from, to) => {
    if (!files.has(String(from))) throw new Error(`ENOENT: ${String(from)}`);
    files.set(String(to), files.get(String(from))!);
  });
  vi.mocked(fs.rmSync).mockImplementation(path => rmSync(String(path)));
  // As the real one: the stored path must exist under the artifact folder.
  vi.mocked(artifactFile).mockImplementation(id => {
    const row = d.query("SELECT path, pages, text, kind, warnings_json FROM pdf_artifacts WHERE id = ?").get(id) as { path: string; pages: number; text: string; kind: "variant"; warnings_json: string } | undefined;
    if (!row || !row.path.startsWith(`${paths.artifacts}/`) || !files.has(row.path)) throw new PreparationError("The PDF is missing or outside the artifact folder.", 404);
    return { path: row.path, text: row.text, artifact: { id, kind: row.kind, pages: row.pages, warnings: JSON.parse(row.warnings_json) } };
  });
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  job = insertJob(d, { title: "Desenvolvedor Full Stack .NET/Angular", description: "Changed later" });
  application = insertApplication(d, { job_id: job });
});

test("saves an approved tailored resume in Resumes with its own copy, role and stacks read from the job", () => {
  const version = tailored("run-1");
  const id = saveTailoredVariant(version)!;
  const variant = variantRecord(id);
  expect(variant).toMatchObject({
    name: "Desenvolvedor Full Stack .NET/Angular", role: "fullstack", stacks: [".NET", "Angular", "C#"], origin: "generated", status: "ready", phase: "complete",
    provider: "opencode", model: "m1", report: "Report", sourceVersion: "s1", pdf: { kind: "variant", pages: 1, warnings: ["Long"] },
    source: { jobId: job, applicationId: application, documentVersionId: version, company: "Example Corp", title: "Desenvolvedor Full Stack .NET/Angular" },
  });
  const copy = artifactFile(variant.pdf!.id);
  expect(copy.path.startsWith(join(paths.artifacts, "variants", id))).toBe(true);
  expect(readFileSync(copy.path)).toBe("%PDF-run-1");
  expect(copy.text).toBe("C# .NET Angular resume");
  expect(d.query("SELECT summary FROM activity_log").all()).toEqual([{ summary: "Saved tailored resume Desenvolvedor Full Stack .NET/Angular" }]);
  // Approving the same version again changes nothing.
  expect(saveTailoredVariant(version)).toBe(id);
  expect(d.query("SELECT COUNT(*) AS n FROM pdf_artifacts WHERE kind = 'variant'").get()).toEqual({ n: 1 });
});

test("a newer approved version replaces the PDF of the same saved resume and keeps the candidate's edits", () => {
  const id = saveTailoredVariant(tailored("run-1"))!;
  updateVariant(id, { name: "Full Stack · C#, Angular", role: "fullstack", stacks_json: JSON.stringify(["C#", "Angular"]) });
  const first = variantRecord(id).pdf!.id;
  const newer = tailored("run-2", { bytes: "%PDF-newer" });
  expect(saveTailoredVariant(newer)).toBe(id);
  const variant = variantRecord(id);
  expect(variant).toMatchObject({ name: "Full Stack · C#, Angular", stacks: ["C#", "Angular"], source: { documentVersionId: newer } });
  expect(variant.pdf!.id).not.toBe(first);
  expect(readFileSync(artifactFile(variant.pdf!.id).path)).toBe("%PDF-newer");
  // The earlier PDF stays on disk for the documents that used it.
  expect(existsSync(artifactFile(first).path)).toBe(true);
  expect(listVariants()).toHaveLength(1);
});

test("ignores unapproved versions and versions made from a saved resume", () => {
  expect(saveTailoredVariant(tailored("run-1", { approved: false }))).toBeNull();
  expect(saveTailoredVariant("missing")).toBeNull();
  const saved = saveTailoredVariant(tailored("run-2"))!;
  expect(saveTailoredVariant(tailored("run-3", { variantId: saved }))).toBeNull();
  expect(listVariants()).toHaveLength(1);
});

test("a PDF outside the artifact folder fails without leaving a folder or row behind", () => {
  const version = tailored("run-1");
  d.query("UPDATE pdf_artifacts SET path = '/etc/hostname' WHERE id = ?").run(version);
  expect(() => saveTailoredVariant(version)).toThrow("outside the artifact folder");
  expect(listVariants()).toEqual([]);
  expect(existsSync(join(paths.artifacts, "variants"))).toBe(false);
});

test("the startup backfill saves each application's latest approved version once and skips missing PDFs", () => {
  tailored("run-1");
  const latest = tailored("run-2", { bytes: "%PDF-latest" });
  tailored("run-3", { approved: false });
  const other = insertApplication(d, { job_id: job, attempt: 2 });
  application = other;
  files.delete(artifactFile(tailored("run-4")).path);
  expect(saveApprovedTailoredResumes()).toBe(1);
  const [variant] = listVariants();
  expect(variant!.source?.documentVersionId).toBe(latest);
  expect(readFileSync(artifactFile(variant!.pdf!.id).path)).toBe("%PDF-latest");
  expect(saveApprovedTailoredResumes()).toBe(0);
  expect(listVariants()).toHaveLength(1);
});
