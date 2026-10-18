import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import type { Dirent } from "node:fs";
import { readTailoringOutput, resetProject, restoreSources, validateTailoredSources, type GenerationManifest } from "./generation.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
vi.mock("../mcp/search.ts", () => ({ jobDetails: vi.fn() }));
const manifest: GenerationManifest = { runId: "r", project: "/a/project", baseProject: "/a/base-project", mainFile: "resume.tex", engine: "pdflatex", reportPath: "/a/report.md", selectionPath: "/a/selection.json", coverPath: "/a/cover-letter.md", manifestPath: "/a/manifest.json" };
const original = "\\documentclass{article}\r\n% keep\r\n\\begin{document}\r\nResume\r\n\\end{document}\r\n";
let files: Record<string, string>;
const entry = (name: string, parentPath: string, file = true) => ({ name, parentPath, isFile: () => file }) as unknown as Dirent;
beforeEach(() => {
  files = {
    "/a/base-project/resume.tex": original,
    "/a/base-project/parts/work.tex": "Work",
    "/a/project/resume.tex": original.replace("Resume", "Tailored"),
    "/a/project/parts/work.tex": "Tailored work",
    "/a/report.md": "# Changes",
    "/a/selection.json": "{}",
  };
  vi.mocked(fs.readFileSync).mockImplementation(path => {
    if (!(String(path) in files)) throw new Error(`ENOENT ${String(path)}`);
    return files[String(path)]!;
  });
  vi.mocked(fs.existsSync).mockImplementation(path => String(path) in files || String(path) === manifest.baseProject);
  vi.mocked(fs.readdirSync).mockReturnValue([entry("resume.tex", "/a/base-project"), entry("parts", "/a/base-project", false), entry("work.tex", "/a/base-project/parts"), entry("logo.png", "/a/base-project")] as never);
  vi.mocked(fs.rmSync).mockReturnValue(undefined);
  vi.mocked(fs.cpSync).mockReturnValue(undefined);
});
test("restores the saved LaTeX sources a retry validates against", () => {
  const sources = restoreSources(manifest, 2);
  expect(sources).toEqual({ manifest, basePages: 2, texFiles: [{ name: "resume.tex", text: original.replaceAll("\r\n", "\n") }, { name: "parts/work.tex", text: "Work" }] });
  expect(() => validateTailoredSources(sources)).not.toThrow();
  expect(() => restoreSources(manifest, undefined)).toThrow("snapshot is missing");
  vi.mocked(fs.existsSync).mockReturnValue(false);
  expect(() => restoreSources(manifest, 1)).toThrow("snapshot is missing");
});
test("resetting the project restores the snapshot and drops partial agent output", () => {
  resetProject(manifest);
  expect(fs.rmSync).toHaveBeenCalledWith("/a/project", { recursive: true, force: true });
  expect(fs.cpSync).toHaveBeenCalledWith("/a/base-project", "/a/project", { recursive: true });
  for (const path of [manifest.reportPath, manifest.selectionPath, manifest.coverPath]) expect(fs.rmSync).toHaveBeenCalledWith(path, { force: true });
});
test("rejects removed comments or a changed preamble", () => {
  const sources = restoreSources(manifest, 1);
  files["/a/project/resume.tex"] = original.replace("% keep\r\n", "");
  expect(() => validateTailoredSources(sources)).toThrow("Restore the original comments in resume.tex");
  files["/a/project/resume.tex"] = original.replace("article", "book");
  expect(() => validateTailoredSources(sources)).toThrow("Preserve the original preamble");
});
test("requires a JSON object selection and a non-empty report", () => {
  expect(readTailoringOutput(manifest)).toBe("# Changes");
  files["/a/selection.json"] = "[]";
  expect(() => readTailoringOutput(manifest)).toThrow("JSON object");
  files["/a/selection.json"] = "{}";
  files["/a/report.md"] = " ";
  expect(() => readTailoringOutput(manifest)).toThrow("report is empty");
  delete files["/a/report.md"];
  expect(() => readTailoringOutput(manifest)).toThrow("report.md and selection.json");
});
