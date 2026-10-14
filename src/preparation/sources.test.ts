import { beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
vi.mock("../paths.ts", () => ({ loadConfig: vi.fn(() => ({})), saveConfig: vi.fn() }));
import { loadConfig, saveConfig } from "../paths.ts";
import { parseResumeData, sourcesConfig } from "./sources.ts";

describe("static resume inputs", () => {
  test("accepts existing TypeScript data and normalizes frameworks without running it", () => {
    const data = parseResumeData('export const RESUME_DATA = { skills: ["ReactJs", "NextJs", "Shadcn/ui"], projects: [{ techStack: ["Node", "TailwindCSS", "next-intl"] }] } as const;', ".ts");
    expect(data.skills).toEqual(["React", "Next.js"]);
    expect(data.projects).toEqual([{ techStack: ["Node.js", "Tailwind CSS"] }]);
  });
  test.each([
    'import x from "secret"; export const RESUME_DATA = {};',
    'export const RESUME_DATA = process.exit();',
    'export const RESUME_DATA = { x: (() => 1)() };',
    'export const RESUME_DATA = { ...process.env };',
    'export const RESUME_DATA = { ["email"]: "x" };',
    'export const RESUME_DATA = { __proto__: {} };',
  ])("rejects executable input: %s", source => expect(() => parseResumeData(source, ".ts")).toThrow());
  test("accepts JSON and rejects malformed array shapes", () => {
    expect(parseResumeData('{"education":[{"end":"2025-09"}]}', ".json")).toEqual({ education: [{ end: "2025-09" }] });
    expect(() => parseResumeData('{"projects":{}}', ".json")).toThrow("projects must be an array");
    expect(() => parseResumeData('{"skills":[42]}', ".json")).toThrow("technology names");
  });
});

describe("repository resume defaults", () => {
  const root = "/fixture/checkout";
  let files: Set<string>;
  beforeEach(() => {
    vi.stubEnv("WORK_TRACKER_REPO_ROOT", root);
    vi.mocked(loadConfig).mockReturnValue({});
    files = new Set();
    vi.spyOn(fs, "statSync").mockImplementation(path => {
      if (!files.has(String(path))) throw new Error("ENOENT");
      return { isFile: () => true } as fs.Stats;
    });
  });
  test("uses the build checkout with no saved settings or current-directory dependency", () => {
    files.add(join(root, "base/latex/resume.tex"));
    files.add(join(root, "base/data/resume-data.ts"));
    expect(sourcesConfig()).toEqual({ projectDir: join(root, "base/latex"), mainFile: "resume.tex", dataFile: join(root, "base/data/resume-data.ts"), engine: "pdflatex" });
    expect(saveConfig).not.toHaveBeenCalled();
  });
  test("uses JSON when both supported data files are present", () => {
    for (const file of ["base/latex/resume.tex", "base/data/resume-data.ts", "base/data/resume-data.json"]) files.add(join(root, file));
    expect(sourcesConfig().dataFile).toBe(join(root, "base/data/resume-data.json"));
  });
  test("supports a template alone and never selects versioned examples", () => {
    files.add(join(root, "base/latex/resume.example.tex"));
    files.add(join(root, "base/data/resume-data.example.ts"));
    expect(sourcesConfig().projectDir).toBe("");
    files.add(join(root, "base/latex/resume.tex"));
    expect(sourcesConfig()).toMatchObject({ projectDir: join(root, "base/latex"), dataFile: "" });
  });
  test("respects explicitly configured projects and compilers", () => {
    const saved = { projectDir: "/another/project", mainFile: "main.tex", dataFile: "", engine: "xelatex" as const };
    vi.mocked(loadConfig).mockReturnValue({ resumeSources: saved });
    expect(sourcesConfig()).toEqual(saved);
    expect(fs.statSync).not.toHaveBeenCalled();
  });
  test("uses the current repository for CLI callers without a desktop root", () => {
    vi.stubEnv("WORK_TRACKER_REPO_ROOT", undefined);
    files.add(join(process.cwd(), "base/latex/resume.tex"));
    expect(sourcesConfig().projectDir).toBe(join(process.cwd(), "base/latex"));
  });
});
