import { beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
vi.mock("../paths.ts", () => ({
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
}));
vi.mock("../profile/evidence.ts", () => ({ isFolder: vi.fn(() => false), profileEvidence: vi.fn() }));
import { loadConfig, saveConfig } from "../paths.ts";
import { isFolder, profileEvidence } from "../profile/evidence.ts";
import { parseResumeData, sourcesConfig } from "./sources.ts";

describe("static resume inputs", () => {
  test("accepts JSON, normalizes frameworks and rejects malformed array shapes", () => {
    const data = parseResumeData('{"skills":["ReactJs","NextJs","Shadcn/ui"],"projects":[{"techStack":["Node","TailwindCSS","next-intl"]}]}', ".json");
    expect(data.skills).toEqual(["React", "Next.js"]);
    expect(data.projects).toEqual([{ techStack: ["Node.js", "Tailwind CSS"] }]);
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
  test("asks to convert TypeScript data to JSON without reading it", () => {
    expect(() => parseResumeData("export const RESUME_DATA = {};", ".ts")).toThrow(
      "TypeScript resume data is no longer supported. Save the RESUME_DATA object as resume-data.json.",
    );
  });
});

describe("repository resume defaults", () => {
  const root = "/fixture/checkout";
  let files: Set<string>;
  beforeEach(() => {
    vi.stubEnv("WORK_TRACKER_REPO_ROOT", root);
    vi.mocked(loadConfig).mockReturnValue({});
    vi.mocked(isFolder).mockReset().mockReturnValue(false);
    files = new Set();
    vi.spyOn(fs, "statSync").mockImplementation((path) => {
      if (!files.has(String(path))) throw new Error("ENOENT");
      return { isFile: () => true } as fs.Stats;
    });
  });
  test("uses the build checkout and its profile folder with no saved settings or current-directory dependency", () => {
    files.add(join(root, "base/latex/resume.tex"));
    files.add(join(root, "base/data/resume-data.json"));
    vi.mocked(isFolder).mockImplementation((path) => path === join(root, "base/data"));
    expect(sourcesConfig()).toEqual({
      projectDir: join(root, "base/latex"),
      mainFile: "resume.tex",
      dataFile: join(root, "base/data/resume-data.json"),
      engine: "pdflatex",
      profileDir: join(root, "base/data"),
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });
  test("never detects TypeScript data", () => {
    files.add(join(root, "base/latex/resume.tex"));
    files.add(join(root, "base/data/resume-data.ts"));
    expect(sourcesConfig()).toMatchObject({ dataFile: "", profileDir: "" });
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
      profileDir: "/another/profile",
    };
    vi.mocked(loadConfig).mockReturnValue({ resumeSources: saved });
    expect(sourcesConfig()).toEqual(saved);
    expect(fs.statSync).not.toHaveBeenCalled();
  });
  test("a configuration saved before the profile folder uses the data file's folder, or none", () => {
    const saved = { projectDir: "/project", mainFile: "resume.tex", dataFile: "/profile/resume-data.json", engine: "pdflatex" as const };
    vi.mocked(loadConfig).mockReturnValue({ resumeSources: saved as never });
    expect(sourcesConfig()).toEqual({ ...saved, profileDir: "/profile" });
    vi.mocked(loadConfig).mockReturnValue({ resumeSources: { ...saved, dataFile: "" } as never });
    expect(sourcesConfig().profileDir).toBe("");
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
      profileDir: "",
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
      { ...config, profileDir: 7 },
      { ...config, profileDir: "relative/profile" },
    ])
      expect(() => saveSources(input)).toThrow();
    expect(saveConfig).not.toHaveBeenCalled();
  });
  test("saves an existing profile folder, and a body without one uses the data file's folder", () => {
    vi.mocked(isFolder).mockImplementation((path) => path === "/profile" || path === "/");
    vi.mocked(profileEvidence).mockReturnValue({ data: null, warnings: [], assets: [], linkedin: null, conflicts: [] });
    expect(saveSources({ ...config, profileDir: " /profile " })).toEqual({ ...config, profileDir: "/profile" });
    expect(saveSources({ projectDir: "/project", mainFile: "resume.tex", dataFile: "/data.json", engine: "pdflatex" })).toMatchObject({ profileDir: "/" });
    expect(() => saveSources({ ...config, profileDir: "/missing" })).toThrow("existing folder");
  });
  test("consolidates the profile folder into the data, so a new import or choice changes the version", () => {
    const data = { profileSources: { conflicts: [], resolved: [] } };
    vi.mocked(profileEvidence).mockReturnValue({ data, warnings: ["1 profile conflict needs a decision."], assets: [], linkedin: null, conflicts: [] });
    const withProfile = snapshotSources({ ...config, dataFile: "/data.json", profileDir: "/profile" });
    expect(profileEvidence).toHaveBeenCalledWith("/profile", { projects: [{}] });
    expect(withProfile.data).toBe(data);
    expect(withProfile.warnings).toContain("1 profile conflict needs a decision.");
    vi.mocked(profileEvidence).mockReturnValue({ data: { profileSources: { conflicts: [], resolved: [{ key: "k" }] } }, warnings: [], assets: [], linkedin: null, conflicts: [] });
    expect(snapshotSources({ ...config, dataFile: "/data.json", profileDir: "/profile" }).version).not.toBe(withProfile.version);
    vi.mocked(profileEvidence).mockClear();
    snapshotSources(config);
    expect(profileEvidence).not.toHaveBeenCalled();
  });
});

test.each([
  ["{", ".json"],
  ["[]", ".json"],
  ["null", ".json"],
  ["{}", ".yaml"],
  ["export const RESUME_DATA = {};", ".ts"],
])("rejects malformed or unsupported resume data %s", (source, extension) => {
  expect(() => parseResumeData(source, extension)).toThrow();
});
