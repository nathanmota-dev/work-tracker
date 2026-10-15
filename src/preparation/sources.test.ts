import { beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
vi.mock("../paths.ts", () => ({
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
}));
import { loadConfig, saveConfig } from "../paths.ts";
import { parseResumeData, sourcesConfig } from "./sources.ts";

describe("static resume inputs", () => {
  test("accepts existing TypeScript data and normalizes frameworks without running it", () => {
    const data = parseResumeData(
      'export const RESUME_DATA = { skills: ["ReactJs", "NextJs", "Shadcn/ui"], projects: [{ techStack: ["Node", "TailwindCSS", "next-intl"] }] } as const;',
      ".ts",
    );
    expect(data.skills).toEqual(["React", "Next.js"]);
    expect(data.projects).toEqual([{ techStack: ["Node.js", "Tailwind CSS"] }]);
  });
  test.each([
    'import x from "secret"; export const RESUME_DATA = {};',
    "export const RESUME_DATA = process.exit();",
    "export const RESUME_DATA = { x: (() => 1)() };",
    "export const RESUME_DATA = { ...process.env };",
    'export const RESUME_DATA = { ["email"]: "x" };',
    "export const RESUME_DATA = { __proto__: {} };",
  ])("rejects executable input: %s", (source) =>
    expect(() => parseResumeData(source, ".ts")).toThrow(),
  );
  test("accepts JSON and rejects malformed array shapes", () => {
    expect(
      parseResumeData('{"education":[{"end":"2025-09"}]}', ".json"),
    ).toEqual({ education: [{ end: "2025-09" }] });
    expect(() => parseResumeData('{"projects":{}}', ".json")).toThrow(
      "projects must be an array",
    );
    expect(() => parseResumeData('{"skills":[42]}', ".json")).toThrow(
      "technology names",
    );
  });
});

describe("repository resume defaults", () => {
  const root = "/fixture/checkout";
  let files: Set<string>;
  beforeEach(() => {
    vi.stubEnv("WORK_TRACKER_REPO_ROOT", root);
    vi.mocked(loadConfig).mockReturnValue({});
    files = new Set();
    vi.spyOn(fs, "statSync").mockImplementation((path) => {
      if (!files.has(String(path))) throw new Error("ENOENT");
      return { isFile: () => true } as fs.Stats;
    });
  });
  test("uses the build checkout with no saved settings or current-directory dependency", () => {
    files.add(join(root, "base/latex/resume.tex"));
    files.add(join(root, "base/data/resume-data.ts"));
    expect(sourcesConfig()).toEqual({
      projectDir: join(root, "base/latex"),
      mainFile: "resume.tex",
      dataFile: join(root, "base/data/resume-data.ts"),
      engine: "pdflatex",
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });
  test("uses JSON when both supported data files are present", () => {
    for (const file of [
      "base/latex/resume.tex",
      "base/data/resume-data.ts",
      "base/data/resume-data.json",
    ])
      files.add(join(root, file));
    expect(sourcesConfig().dataFile).toBe(
      join(root, "base/data/resume-data.json"),
    );
  });
  test("supports a template alone and never selects versioned examples", () => {
    files.add(join(root, "base/latex/resume.example.tex"));
    files.add(join(root, "base/data/resume-data.example.ts"));
    expect(sourcesConfig().projectDir).toBe("");
    files.add(join(root, "base/latex/resume.tex"));
    expect(sourcesConfig()).toMatchObject({
      projectDir: join(root, "base/latex"),
      dataFile: "",
    });
  });
  test("respects explicitly configured projects and compilers", () => {
    const saved = {
      projectDir: "/another/project",
      mainFile: "main.tex",
      dataFile: "",
      engine: "xelatex" as const,
    };
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

import { saveSources, snapshotSources, writeSnapshot } from "./sources.ts";
import type { ResumeSourcesConfig } from "./types.ts";
describe("isolated source snapshots", () => {
  let config: ResumeSourcesConfig;
  let entries: Record<string, { text: string; size?: number; link?: boolean }>;
  beforeEach(() => {
    config = {
      projectDir: "/project",
      mainFile: "resume.tex",
      dataFile: "",
      engine: "pdflatex",
    };
    entries = {
      "resume.tex": { text: "resume" },
      "assets/logo.png": { text: "image" },
      "output/a.pdf": { text: "compiled" },
      ".git/config": { text: "git" },
      "resume.example.tex": { text: "example" },
      "resume.aux": { text: "aux" },
    };
    vi.mocked(loadConfig).mockReturnValue({});
    vi.mocked(fs.existsSync).mockImplementation(
      (path) =>
        String(path) === "/project" ||
        String(path) === "/data.json" ||
        Object.hasOwn(entries, String(path).replace("/project/", "")),
    );
    vi.spyOn(fs, "realpathSync").mockImplementation((path) => String(path));
    vi.spyOn(fs, "statSync").mockImplementation(
      (path) =>
        ({
          isDirectory: () => String(path) === "/project",
          isFile: () => String(path) !== "/project",
          size: entries[String(path).replace("/project/", "")]?.size ?? 6,
        }) as fs.Stats,
    );
    vi.mocked(fs.readdirSync).mockImplementation((path: fs.PathLike) => {
      const prefix =
        String(path) === "/project"
          ? ""
          : String(path).replace("/project/", "") + "/";
      return [
        ...new Set(
          Object.keys(entries)
            .filter((name) => name.startsWith(prefix))
            .map((name) => name.slice(prefix.length).split("/")[0]),
        ),
      ].map((name) => ({
        name,
        isSymbolicLink: () => !!entries[prefix + name]?.link,
        isDirectory: () => !Object.hasOwn(entries, prefix + name),
        isFile: () => Object.hasOwn(entries, prefix + name),
      })) as unknown as ReturnType<typeof fs.readdirSync>;
    });
    vi.mocked(fs.readFileSync).mockImplementation((path, encoding) => {
      const text =
        String(path) === "/data.json"
          ? '{"projects":[{}]}'
          : entries[String(path).replace("/project/", "")]!.text;
      return encoding ? text : Buffer.from(text);
    });
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });
  test("includes assets, ignores generated/examples files and hashes deterministically", () => {
    const first = snapshotSources(config);
    expect(first.files.map((file) => file.name)).toEqual([
      "assets/logo.png",
      "resume.tex",
    ]);
    expect(first.warnings).toEqual([
      expect.stringContaining("No optional data"),
    ]);
    entries = Object.fromEntries(Object.entries(entries).reverse());
    expect(snapshotSources(config).version).toBe(first.version);
    entries["resume.tex"]!.text = "changed";
    expect(snapshotSources(config).version).not.toBe(first.version);
    expect(snapshotSources({ ...config, engine: "xelatex" }).version).not.toBe(
      snapshotSources(config).version,
    );
  });
  test("warns about missing evidence in optional data and includes selected example main", () => {
    expect(
      snapshotSources({ ...config, dataFile: "/data.json" }).warnings,
    ).toEqual([expect.stringContaining("no descriptions")]);
    expect(
      snapshotSources({ ...config, mainFile: "resume.example.tex" }).files.some(
        (file) => file.name === "resume.example.tex",
      ),
    ).toBe(true);
  });
  test.each([
    { projectDir: "relative" },
    { projectDir: "" },
    { projectDir: "/missing" },
    { mainFile: "../outside.tex" },
    { mainFile: "/project/resume.tex" },
    { mainFile: "-resume.tex" },
    { mainFile: "resume.pdf" },
    { mainFile: "missing.tex" },
    { engine: "unknown" },
    { dataFile: "relative.json" },
  ])("rejects unsafe/missing settings %j", (patch) => {
    expect(() =>
      snapshotSources({ ...config, ...patch } as ResumeSourcesConfig),
    ).toThrow();
  });
  test("rejects links and projects larger than 100 MB", () => {
    entries["linked.tex"] = { text: "", link: true };
    expect(() => snapshotSources(config)).toThrow("linked assets");
    delete entries["linked.tex"];
    entries["resume.tex"]!.size = 100 * 1024 * 1024 + 1;
    expect(() => snapshotSources(config)).toThrow("exceeds 100 MB");
  });
  test("writes source bytes with private permissions", () => {
    const snapshot = snapshotSources(config);
    writeSnapshot(snapshot, "/copy");
    expect(fs.mkdirSync).toHaveBeenCalledWith("/copy", {
      recursive: true,
      mode: 0o700,
    });
    expect(fs.mkdirSync).toHaveBeenCalledWith("/copy/assets", {
      recursive: true,
    });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/copy/assets/logo.png",
      Buffer.from("image"),
      { mode: 0o600 },
    );
  });
  test("validates before persisting normalized sources and preserves other settings", () => {
    vi.mocked(loadConfig).mockReturnValue({ username: "candidate" });
    expect(
      saveSources({
        ...config,
        projectDir: " /project ",
        mainFile: " resume.tex ",
      }),
    ).toEqual(config);
    expect(saveConfig).toHaveBeenLastCalledWith({
      username: "candidate",
      resumeSources: config,
    });
    vi.mocked(saveConfig).mockClear();
    for (const input of [
      null,
      {},
      { ...config, engine: "bad" },
      { ...config, projectDir: "/missing" },
    ])
      expect(() => saveSources(input)).toThrow();
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

test.each([
  ["{", ".json"],
  ["[]", ".json"],
  ["null", ".json"],
  ["{}", ".yaml"],
  ["export const OTHER = {};", ".ts"],
  ["export let RESUME_DATA = {};", ".ts"],
])("rejects malformed or unsupported resume data %s", (source, extension) => {
  expect(() => parseResumeData(source, extension)).toThrow();
});
