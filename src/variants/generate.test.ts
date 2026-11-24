import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import type { SourcesSnapshot } from "../preparation/sources.ts";
import { basePreview, compileWithCorrection, copyBaseline, texSources, writeProject } from "../preparation/pipeline.ts";
import { insertVariant, variantRecord } from "./store.ts";
import { generateVariant } from "./generate.ts";

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs")>()), writeFileSync: vi.fn(), copyFileSync: vi.fn() }));
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-24T12:00:00.000Z" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
vi.mock("../preparation/pipeline.ts", async original => ({
  ...(await original<typeof import("../preparation/pipeline.ts")>()),
  writeProject: vi.fn(), basePreview: vi.fn(), copyBaseline: vi.fn(), texSources: vi.fn(), compileWithCorrection: vi.fn(),
}));

let d: Database;
const snapshot = { version: "v1", warnings: ["No optional data file"], config: { mainFile: "resume.tex", engine: "pdflatex" } } as unknown as SourcesSnapshot;
const hooks = { phase: vi.fn(), agent: vi.fn(async () => true) };
const compiled = { path: "/tmp/resume.pdf", log: "ok", check: { pages: 2, text: "C# resume", warnings: [] as string[] } };
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  insertVariant("v", { name: "Back-End · C#", role: "backend", stacks: ["C#", ".NET"], focus: "APIs", language: "pt", provider: "opencode", model: null }, "generated");
  vi.mocked(writeProject).mockImplementation(root => ({ baseProject: `${root}/base-project`, project: `${root}/project`, profilePath: `${root}/profile.json` }));
  vi.mocked(basePreview).mockResolvedValue({ id: "base", kind: "base", pages: 1, warnings: [] });
  vi.mocked(copyBaseline).mockReturnValue({ path: "/root/base.pdf", text: "Base" });
  vi.mocked(texSources).mockReturnValue([]);
  vi.mocked(compileWithCorrection).mockImplementation(async (_sources, _signal, { phase, correct }) => { phase("compiling"); phase("tailoring"); await correct("fix it"); return { compiled, report: "Report" }; });
});

test("tailors the project for the role and stacks, then registers a new variant PDF", async () => {
  await expect(generateVariant("v", snapshot, new AbortController().signal, hooks)).resolves.toBe(true);
  const manifest = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string);
  expect(manifest).toMatchObject({ variantId: "v", target: { kind: "variant", role: "backend", stacks: ["C#", ".NET"], focus: "APIs", language: "pt" }, coverPath: null, sourceVersion: "v1", baseArtifactId: "base", mainFile: "resume.tex" });
  expect(manifest.project).toMatch(/^\/artifacts\/variants\/v\/[0-9a-f-]{36}\/project$/);
  expect(hooks.agent).toHaveBeenCalledWith(manifest.manifestPath, "");
  expect(hooks.agent).toHaveBeenCalledWith(manifest.manifestPath, "fix it");
  expect(hooks.phase.mock.calls.map(call => call[0])).toEqual(["tailoring", "compiling", "tailoring"]);
  expect(fs.copyFileSync).toHaveBeenCalledWith(compiled.path, manifest.project.replace(/project$/, "resume.pdf"));
  const variant = variantRecord("v");
  expect(variant).toMatchObject({ status: "ready", phase: "complete", report: "Report", sourceVersion: "v1", error: null, pdf: { kind: "variant", pages: 2, warnings: [expect.stringContaining("2 pages")] } });
  expect(d.query("SELECT source_version, run_id FROM pdf_artifacts WHERE id = ?").get(variant.pdf!.id)).toEqual({ source_version: "v1", run_id: null });
  expect(d.query("SELECT summary FROM activity_log").get()).toEqual({ summary: "Generated saved resume Back-End · C#" });
});

test("stops without a PDF while the agent waits for sign-in", async () => {
  hooks.agent.mockResolvedValueOnce(false);
  await expect(generateVariant("v", snapshot, new AbortController().signal, hooks)).resolves.toBe(false);
  expect(compileWithCorrection).not.toHaveBeenCalled();
  vi.mocked(compileWithCorrection).mockResolvedValueOnce(undefined);
  await expect(generateVariant("v", snapshot, new AbortController().signal, hooks)).resolves.toBe(false);
  expect(variantRecord("v").pdf).toBeNull();
});
