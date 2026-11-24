import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import { databaseDouble } from "../test/doubles.ts";
import { compileLatex } from "./latex.ts";
import { writeSnapshot, type SourcesSnapshot } from "./sources.ts";
import { addArtifact, artifactFile, cachedPreview } from "./store.ts";
import { basePreview, compileWithCorrection, copyBaseline, texSources, warnLength, writeProject } from "./pipeline.ts";
import type { GenerationSources, TailoringPaths } from "./generation.ts";

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs")>()), ...Object.fromEntries(["existsSync", "readFileSync", "writeFileSync", "copyFileSync"].map(name => [name, vi.fn()])) }));
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "now" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
vi.mock("./latex.ts", () => ({ compileLatex: vi.fn() }));
vi.mock("./sources.ts", async original => ({ ...(await original<typeof import("./sources.ts")>()), writeSnapshot: vi.fn() }));
vi.mock("./store.ts", () => ({ addArtifact: vi.fn(), artifactFile: vi.fn(), cachedPreview: vi.fn() }));

const snapshot = { version: "v1", data: { skills: ["C#"] }, warnings: [], config: { mainFile: "resume.tex", engine: "pdflatex" }, files: [{ name: "resume.tex", bytes: Buffer.from("A\r\nB") }, { name: "photo.png", bytes: Buffer.from("png") }] } as unknown as SourcesSnapshot;
const manifest: TailoringPaths = { project: "/root/project", mainFile: "resume.tex", engine: "pdflatex", reportPath: "/root/report.md", selectionPath: "/root/selection.json", manifestPath: "/root/manifest.json" };
const sources: GenerationSources<TailoringPaths> = { manifest, texFiles: [{ name: "resume.tex", text: "\\begin{document}\nBase" }], basePages: 1 };
const compiled = { path: "/root/project/resume.pdf", log: "ok", check: { pages: 2, text: "Tailored", warnings: [] as string[] } };
beforeEach(() => {
  vi.mocked(db).mockReturnValue(databaseDouble().asDatabase);
  vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockImplementation(path => String(path).endsWith(".json") ? "{}" : String(path).endsWith(".md") ? "Report" : "\\begin{document}\nTailored");
  vi.mocked(compileLatex).mockReset().mockResolvedValue(compiled);
});

test("writes the pristine and working projects with the profile", () => {
  expect(writeProject("/root", snapshot)).toEqual({ baseProject: "/root/base-project", project: "/root/project", profilePath: "/root/profile.json" });
  expect(writeSnapshot).toHaveBeenCalledWith(snapshot, "/root/base-project");
  expect(writeSnapshot).toHaveBeenCalledWith(snapshot, "/root/project");
  expect(fs.writeFileSync).toHaveBeenCalledWith("/root/profile.json", JSON.stringify(snapshot.data, null, 2), { mode: 0o600 });
  expect(texSources(snapshot)).toEqual([{ name: "resume.tex", text: "A\nB" }]);
});

test("reuses the cached base preview and copies the baseline next to a generation", async () => {
  vi.mocked(cachedPreview).mockReturnValueOnce({ id: "cached", kind: "base", pages: 1, warnings: [] });
  await expect(basePreview(snapshot)).resolves.toMatchObject({ id: "cached" });
  expect(compileLatex).not.toHaveBeenCalled();
  vi.mocked(addArtifact).mockReturnValueOnce({ id: "new", kind: "base", pages: 2, warnings: [] });
  await expect(basePreview(snapshot)).resolves.toMatchObject({ id: "new" });
  expect(addArtifact).toHaveBeenCalledWith(null, "base", compiled.path, compiled.check, "v1");
  vi.mocked(artifactFile).mockReturnValue({ path: "/artifacts/base.pdf", text: "Base", artifact: { id: "new", kind: "base", pages: 2, warnings: [] } });
  expect(copyBaseline({ id: "new", kind: "base", pages: 2, warnings: [] }, "/root")).toEqual({ path: "/root/base.pdf", text: "Base" });
});

test("allows one correction, then reports the error; a sign-in wait stops without a result", async () => {
  const phases: string[] = [];
  const correct = vi.fn(async () => true);
  vi.mocked(compileLatex).mockRejectedValueOnce(new Error("bad"));
  await expect(compileWithCorrection(sources, new AbortController().signal, { phase: phase => phases.push(phase), correct })).resolves.toEqual({ compiled, report: "Report" });
  expect(phases).toEqual(["compiling", "tailoring", "compiling"]);
  expect(correct).toHaveBeenCalledWith(expect.stringContaining("bad"));
  vi.mocked(compileLatex).mockRejectedValue(new Error("still bad"));
  await expect(compileWithCorrection(sources, new AbortController().signal, { phase: () => {}, correct })).rejects.toThrow("still bad");
  await expect(compileWithCorrection(sources, new AbortController().signal, { phase: () => {}, correct: async () => false })).resolves.toBeUndefined();
});

test("warns when the tailored resume is longer than its base", () => {
  const check = { ...compiled, check: { ...compiled.check, warnings: ["Existing"] } };
  warnLength(check, 1);
  expect(check.check.warnings).toEqual([expect.stringContaining("2 pages; the base has 1"), "Existing"]);
  warnLength(check, 2);
  expect(check.check.warnings).toHaveLength(2);
});
