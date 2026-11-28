import { beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
vi.mock("../paths.ts", () => ({
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  paths: { profile: "/home/.work-tracker/profile" },
}));
vi.mock("../profile/evidence.ts", () => ({ profileEvidence: vi.fn() }));
import { loadConfig, saveConfig } from "../paths.ts";
import { profileEvidence } from "../profile/evidence.ts";
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
});

describe("repository resume defaults", () => {
  const root = "/fixture/checkout";
  const profileDir = "/home/.work-tracker/profile";
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
  test("uses the build checkout's LaTeX and the app's profile folder, with no saved settings", () => {
    files.add(join(root, "base/latex/resume.tex"));
    expect(sourcesConfig()).toEqual({ projectDir: join(root, "base/latex"), mainFile: "resume.tex", dataFile: "", engine: "pdflatex", profileDir });
    expect(saveConfig).not.toHaveBeenCalled();
  });
  test("never selects the versioned example", () => {
    files.add(join(root, "base/latex/resume.example.tex"));
    expect(sourcesConfig()).toMatchObject({ projectDir: "", profileDir });
  });
  test("respects saved LaTeX settings but always reads the app's profile folder", () => {
    const saved = { projectDir: "/another/project", mainFile: "main.tex", dataFile: "/old/resume-data.json", engine: "xelatex" as const, profileDir: "/old" };
    vi.mocked(loadConfig).mockReturnValue({ resumeSources: saved });
    expect(sourcesConfig()).toEqual({ ...saved, dataFile: "", profileDir });
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
    expect(first.warnings).toEqual([]);
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
  test("validates before persisting normalized LaTeX settings and preserves other settings", () => {
    vi.mocked(loadConfig).mockReturnValue({ username: "candidate" });
    vi.mocked(profileEvidence).mockReturnValue({ data: null, raw: null, source: null, warnings: [], assets: [] });
    const saved = { ...config, profileDir: "/home/.work-tracker/profile" };
    expect(saveSources({ ...config, projectDir: " /project ", mainFile: " resume.tex ", dataFile: "/ignored.json" })).toEqual(saved);
    expect(saveConfig).toHaveBeenLastCalledWith({ username: "candidate", resumeSources: saved });
    vi.mocked(saveConfig).mockClear();
    for (const input of [null, {}, { ...config, engine: "bad" }, { ...config, projectDir: "/missing" }, { ...config, mainFile: 7 }])
      expect(() => saveSources(input)).toThrow();
    expect(saveConfig).not.toHaveBeenCalled();
  });
  test("adds the profile to the data, so a new upload or import changes the version", () => {
    const data = { name: "Ada", profileSources: { references: [] } };
    vi.mocked(profileEvidence).mockReturnValue({ data, raw: data, source: { kind: "data", file: "resume-data.json" }, warnings: ["new.pdf has not been imported yet."], assets: [] });
    const withProfile = snapshotSources({ ...config, profileDir: "/profile" });
    expect(profileEvidence).toHaveBeenCalledWith("/profile");
    expect(withProfile.data).toBe(data);
    expect(withProfile.warnings).toEqual(["new.pdf has not been imported yet."]);
    vi.mocked(profileEvidence).mockReturnValue({ data: { name: "Bea" }, raw: { name: "Bea" }, source: { kind: "data", file: "resume-data.json" }, warnings: [], assets: [] });
    expect(snapshotSources({ ...config, profileDir: "/profile" }).version).not.toBe(withProfile.version);
    vi.mocked(profileEvidence).mockReturnValue({ data: null, raw: null, source: null, warnings: [], assets: [] });
    expect(snapshotSources({ ...config, profileDir: "/profile" }).warnings).toEqual([expect.stringContaining("Upload your resume data or LinkedIn PDF in Profile.")]);
    vi.mocked(profileEvidence).mockClear();
    snapshotSources(config);
    expect(profileEvidence).not.toHaveBeenCalled();
  });
  test("hidden entries need no description", () => {
    vi.mocked(profileEvidence).mockReturnValue({ data: { work: [{ company: "Old", hidden: true }] }, raw: null, source: null, warnings: [], assets: [] });
    expect(snapshotSources({ ...config, profileDir: "/profile" }).warnings).not.toContainEqual(expect.stringContaining("no descriptions"));
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
