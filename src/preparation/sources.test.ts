import { beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
vi.mock("../paths.ts", () => ({ paths: { profile: "/home/.work-tracker/profile", baseResume: "/home/.work-tracker/resume" } }));
vi.mock("../profile/evidence.ts", () => ({ profileEvidence: vi.fn() }));
vi.mock("../resume/base.ts", () => ({ BASE_RESUME_FILE: "resume.tex", writeBaseResume: vi.fn() }));
import { profileEvidence } from "../profile/evidence.ts";
import { writeBaseResume } from "../resume/base.ts";
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

describe("base resume sources", () => {
  test("are the app's generated LaTeX and profile folder, with nothing to configure", () => {
    expect(sourcesConfig()).toEqual({ projectDir: "/home/.work-tracker/resume", mainFile: "resume.tex", engine: "pdflatex", dataFile: "", profileDir: "/home/.work-tracker/profile" });
  });
  test("are generated again from the profile before every snapshot, while a recorded copy is only read", () => {
    vi.mocked(writeBaseResume).mockImplementation(() => { throw new Error("Upload your resume data."); });
    expect(() => snapshotSources()).toThrow("Upload your resume data.");
    expect(writeBaseResume).toHaveBeenCalledOnce();
  });
});

import { snapshotSources, writeSnapshot } from "./sources.ts";
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
  test("adds the profile to the data, so a new upload or import changes the version", () => {
    const data = { name: "Ada", profileSources: { references: [] } };
    vi.mocked(profileEvidence).mockReturnValue({ data, raw: data, source: { kind: "data", file: "resume-data.json" }, warnings: ["new.pdf has not been imported yet."], assets: [] });
    const withProfile = snapshotSources({ ...config, profileDir: "/profile" });
    expect(profileEvidence).toHaveBeenCalledWith("/profile");
    expect(withProfile.data).toBe(data);
    expect(withProfile.warnings).toEqual(["new.pdf has not been imported yet."]);
    vi.mocked(profileEvidence).mockReturnValue({ data: { name: "Bea" }, raw: { name: "Bea" }, source: { kind: "data", file: "resume-data.json" }, warnings: [], assets: [] });
    expect(snapshotSources({ ...config, profileDir: "/profile" }).version).not.toBe(withProfile.version);
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
