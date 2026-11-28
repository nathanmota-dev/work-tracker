import { afterAll, beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { paths } from "../paths.ts";
import { compileLatex } from "../preparation/latex.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { deferred } from "../test/doubles.ts";
import { insertTailoredVariant, insertVariant, updateVariant, variantManifest, variantRecord } from "./store.ts";
import { latexErrors, readVariantLatex, resolveVariantProject, saveVariantLatex } from "./source.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-27T12:00:00.000Z" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "" } }));
vi.mock("../answers/store.ts", () => ({ contactIdentity: () => ({}) }));
vi.mock("../preparation/latex.ts", () => ({ compileLatex: vi.fn() }));

// Projects are folders of files, so these tests opt in to real I/O in a private temporary folder.
const real = await vi.importActual<typeof import("node:fs")>("node:fs");
const root = real.mkdtempSync(join(tmpdir(), "work-tracker-variant-latex-"));
const guarded = ["existsSync", "mkdirSync", "readFileSync", "writeFileSync", "cpSync", "readdirSync", "rmSync"] as const;
afterAll(() => real.rmSync(root, { recursive: true, force: true }));

let d: Database;
let artifacts: string;
let count = 0;
const check = { pages: 1, text: "Edited resume", warnings: [] as string[] };

/** A LaTeX project with `files`, plus compiler output that is never a source. */
function project(dir: string, files: Record<string, string> = { "resume.tex": "\\documentclass{article}\r\nOld" }): string {
  for (const [name, text] of Object.entries({ ...files, "output/resume.pdf": "%PDF-old", "output/stale.tex": "x" })) {
    real.mkdirSync(join(dir, name, ".."), { recursive: true });
    real.writeFileSync(join(dir, name), text);
  }
  return dir;
}

/** A generated resume whose manifest points at its own project. */
function generated(id = "v", files?: Record<string, string>): string {
  insertVariant(id, { name: "Back-End · C#", role: "backend", stacks: ["C#"] }, "generated");
  const dir = project(join(artifacts, "variants", id, "gen", "project"), files);
  updateVariant(id, { status: "ready", manifest_json: JSON.stringify({ project: dir, mainFile: "resume.tex", engine: "pdflatex", baseArtifactId: "base", manifestPath: "/m.json" }) });
  return dir;
}

/** A resume saved from an approved Apply version; returns the Apply project. */
function tailored(id = "t"): string {
  const job = insertJob(d);
  const application = insertApplication(d, { job_id: job });
  const dir = project(join(artifacts, "applications", String(job), "run", "project"), { "resume.tex": "Apply main", "sections/work.tex": "Apply work" });
  d.query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, manifest_json, created_at, updated_at) VALUES ('run', ?, ?, 'completed', 'review', 'opencode', ?, 'now', 'now')")
    .run(job, application, JSON.stringify({ project: dir, mainFile: "resume.tex", engine: "xelatex" }));
  d.query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES ('doc', 'run', 'tailored', '/x.pdf', 1, 't', '[]')").run();
  d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at, approved_at) VALUES ('doc', 'run', ?, 'h', 's1', '{}', 'now', 'now')").run(application);
  insertTailoredVariant(id, { name: "Full Stack", role: "fullstack", stacks: ["C#"] }, { jobId: job, applicationId: application, documentVersionId: "doc", pdfArtifactId: "doc", provider: null, model: null, report: null, sourceVersion: "s1" });
  return dir;
}

/** The compiler writes its PDF where latexmk would, creating its output folder. */
function compiles() {
  vi.mocked(compileLatex).mockImplementation(async dir => {
    real.mkdirSync(join(dir, "output"), { recursive: true });
    real.writeFileSync(join(dir, "output", "resume.pdf"), "%PDF-new");
    return { path: join(dir, "output", "resume.pdf"), log: "ok", check };
  });
}

beforeEach(async () => {
  for (const name of guarded) vi.mocked(fs[name]).mockImplementation(real[name] as never);
  artifacts = join(root, `artifacts-${++count}`);
  real.mkdirSync(artifacts, { recursive: true });
  paths.artifacts = artifacts;
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  vi.mocked(compileLatex).mockReset();
  compiles();
});

test("reads a generated resume's own project, main file first, without compiler output", () => {
  const dir = generated("v", { "resume.tex": "Main\r\nline", "a.tex": "A" });
  expect(resolveVariantProject("v")).toEqual({ project: real.realpathSync(dir), mainFile: "resume.tex", engine: "pdflatex", owned: true });
  expect(readVariantLatex("v")).toEqual({ mainFile: "resume.tex", files: [{ name: "resume.tex", text: "Main\nline" }, { name: "a.tex", text: "A" }] });
});

test("reads a resume tailored in Apply from its execution until it is edited", () => {
  const dir = tailored();
  expect(resolveVariantProject("t")).toMatchObject({ project: real.realpathSync(dir), engine: "xelatex", owned: false });
  expect(readVariantLatex("t").files.map(file => file.name)).toEqual(["resume.tex", "sections/work.tex"]);
});

test("an imported resume, or a project outside the artifact folder, has no source", () => {
  insertVariant("i", { name: "Imported", role: "other", stacks: ["Go"] }, "imported");
  expect(() => readVariantLatex("i")).toThrow(expect.objectContaining({ status: 409 }));
  generated("o");
  updateVariant("o", { manifest_json: JSON.stringify({ project: project(join(root, `outside-${count}`)), mainFile: "resume.tex", engine: "pdflatex" }) });
  expect(() => resolveVariantProject("o")).toThrow(expect.objectContaining({ status: 409 }));
});

test("saving compiles a new PDF and keeps the earlier one", async () => {
  const dir = generated();
  updateVariant("v", { pdf_artifact_id: null });
  const saved = await saveVariantLatex("v", [{ name: "resume.tex", text: "New" }]);
  expect(real.readFileSync(join(dir, "resume.tex"), "utf8")).toBe("New");
  expect(compileLatex).toHaveBeenCalledWith(real.realpathSync(dir), "resume.tex", "pdflatex", undefined, { layout: { identity: {} } });
  const row = d.query("SELECT path, run_id FROM pdf_artifacts WHERE id = ?").get(saved.pdf!.id) as { path: string; run_id: string | null };
  expect(row.run_id).toBeNull();
  expect(row.path).toMatch(new RegExp(`^${artifacts}/variants/v/[0-9a-f-]{36}/resume\\.pdf$`));
  expect(real.readFileSync(row.path, "utf8")).toBe("%PDF-new");
  const second = await saveVariantLatex("v", [{ name: "resume.tex", text: "Newer" }]);
  expect(second.pdf!.id).not.toBe(saved.pdf!.id);
  expect(real.existsSync(row.path)).toBe(true);
  expect(variantManifest("v")).toMatchObject({ baseArtifactId: "base", manifestPath: "/m.json" });
  expect(d.query("SELECT summary FROM activity_log").all()).toEqual([{ summary: "Edited saved resume Back-End · C#" }, { summary: "Edited saved resume Back-End · C#" }]);
});

test("the first save of an Apply resume copies its project and leaves the Apply one untouched", async () => {
  const applyDir = tailored();
  await saveVariantLatex("t", [{ name: "sections/work.tex", text: "Edited work" }]);
  expect(real.readFileSync(join(applyDir, "sections/work.tex"), "utf8")).toBe("Apply work");
  const own = join(artifacts, "variants", "t", "source", "project");
  expect(variantManifest("t")).toEqual({ project: own, mainFile: "resume.tex", engine: "xelatex" });
  expect(real.readFileSync(join(own, "sections/work.tex"), "utf8")).toBe("Edited work");
  expect(real.readFileSync(join(own, "resume.tex"), "utf8")).toBe("Apply main");
  expect(real.existsSync(join(own, "output", "stale.tex"))).toBe(false);
  expect(resolveVariantProject("t")).toMatchObject({ owned: true });
});

test("a compilation error keeps the edit and the previous PDF and lists the LaTeX errors", async () => {
  const dir = generated();
  updateVariant("v", { pdf_artifact_id: null });
  vi.mocked(compileLatex).mockRejectedValue(new Error("latexmk failed (12):\nnoise\n./resume.tex:3: Undefined control sequence.\n./resume.tex:3: Undefined control sequence."));
  const failure = saveVariantLatex("v", [{ name: "resume.tex", text: "\\oops" }]);
  await expect(failure).rejects.toMatchObject({ status: 422, message: "LaTeX could not compile the resume. Your changes are saved.\n./resume.tex:3: Undefined control sequence." });
  expect(real.readFileSync(join(dir, "resume.tex"), "utf8")).toBe("\\oops");
  expect(variantRecord("v").pdf).toBeNull();
});

test("summarizes a log without file errors by its tail", () => {
  expect(latexErrors("a\nb\n! Emergency stop.\n")).toBe("a\nb\n! Emergency stop.");
});

test.each([
  [[{ name: "new.tex", text: "x" }], 400],
  [[{ name: "../resume.tex", text: "x" }], 400],
  [[{ name: "output/stale.tex", text: "x" }], 400],
  [[{ name: "resume.tex", text: "x" }, { name: "resume.tex", text: "y" }], 400],
  [[{ name: "resume.tex", text: "x".repeat(1024 * 1024 + 1) }], 400],
  [[], 400],
  ["resume.tex", 400],
])("rejects invalid files %#", async (files, status) => {
  generated();
  await expect(saveVariantLatex("v", files)).rejects.toMatchObject({ status });
  expect(compileLatex).not.toHaveBeenCalled();
});

test("rejects archived, generating and concurrent saves", async () => {
  generated("a");
  updateVariant("a", { archived_at: "now" });
  await expect(saveVariantLatex("a", [{ name: "resume.tex", text: "x" }])).rejects.toMatchObject({ status: 409 });
  generated("g");
  updateVariant("g", { status: "generating" });
  await expect(saveVariantLatex("g", [{ name: "resume.tex", text: "x" }])).rejects.toMatchObject({ status: 409 });
  generated("v");
  const build = deferred<void>();
  vi.mocked(compileLatex).mockImplementationOnce(async dir => { await build.promise; return { path: join(dir, "output", "resume.pdf"), log: "", check }; });
  const first = saveVariantLatex("v", [{ name: "resume.tex", text: "1" }]);
  await expect(saveVariantLatex("v", [{ name: "resume.tex", text: "2" }])).rejects.toMatchObject({ status: 409 });
  build.resolve();
  await expect(first).resolves.toMatchObject({ id: "v" });
});
