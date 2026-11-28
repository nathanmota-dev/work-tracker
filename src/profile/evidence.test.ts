import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { profileAssets } from "./assets.ts";
import { isFolder, profileEvidence } from "./evidence.ts";
import { cachedImports } from "./store.ts";
import type { LinkedInProfile, ProfileImport } from "./types.ts";

vi.mock("./assets.ts", () => ({ profileAssets: vi.fn() }));
vi.mock("./store.ts", () => ({ cachedImports: vi.fn() }));

const profile = {
  name: "Alex Example", headline: "", location: "", summary: "", publications: [], warnings: [], languages: [], certifications: [], education: [],
  contact: { email: "", phone: "", linkedin: "", github: "", website: "" }, topSkills: ["ReactJs"],
  experience: [{ company: "Northwind Labs", title: "Engineer", start: "2022-12", end: "Present", location: "", bullets: [] }],
} as LinkedInProfile;
const stored = (hash: string, fields: Partial<ProfileImport>): ProfileImport => ({ hash, kind: "reference", file: hash, parserVersion: 1, profile: null, text: "Resume", warnings: [], ...fields });
const DATA = JSON.stringify({ name: "Dana Data", skills: ["ReactJs"] });
let dataFile: string | null;
beforeEach(() => {
  dataFile = null;
  vi.mocked(fs.existsSync).mockImplementation(path => String(path).endsWith("resume-data.json") ? dataFile !== null : true);
  vi.mocked(fs.readFileSync).mockImplementation(() => dataFile ?? "");
  vi.spyOn(fs, "statSync").mockReturnValue({ isDirectory: () => true } as fs.Stats);
  vi.mocked(profileAssets).mockReturnValue({ assets: ["export.pdf", "second-export.pdf", "focus.pdf", "scan.pdf", "new.pdf"].map(file => ({ file, path: `/profile/${file}`, sha256: file })), warnings: ["big.pdf exceeds 20 MB and was skipped."] });
  vi.mocked(cachedImports).mockReturnValue(new Map([
    ["export.pdf", stored("export.pdf", { kind: "linkedin", profile, text: "Alex", warnings: ["No summary."] })],
    ["second-export.pdf", stored("second-export.pdf", { kind: "linkedin", profile, text: "Older export" })],
    ["focus.pdf", stored("focus.pdf", {})],
    ["scan.pdf", stored("scan.pdf", { text: "", warnings: ["The PDF has no extractable text."] })],
  ]));
});

test("only an absolute existing folder is a profile folder", () => {
  expect(isFolder("/profile")).toBe(true);
  expect(isFolder("relative")).toBe(false);
  vi.mocked(fs.existsSync).mockImplementation(() => { throw new Error("EACCES"); });
  expect(isFolder("/profile")).toBe(false);
});

test("uses the first LinkedIn export as the profile and the other PDFs as references", () => {
  const evidence = profileEvidence("/profile");
  expect(evidence.source).toEqual({ kind: "linkedin", file: "export.pdf" });
  expect(evidence.raw).toMatchObject({ name: "Alex Example", skills: ["ReactJs"], work: [{ company: "Northwind Labs" }] });
  expect(evidence.data).toMatchObject({ name: "Alex Example", skills: ["React"], profileSources: { references: [{ file: "second-export.pdf", text: "Older export" }, { file: "focus.pdf", text: "Resume" }] } });
  expect(evidence.assets).toEqual([
    { file: "export.pdf", kind: "linkedin", status: "imported", warnings: ["No summary."] },
    { file: "second-export.pdf", kind: "linkedin", status: "imported", warnings: [] },
    { file: "focus.pdf", kind: "reference", status: "imported", warnings: [] },
    { file: "scan.pdf", kind: "reference", status: "failed", warnings: ["The PDF has no extractable text."] },
    { file: "new.pdf", kind: null, status: "pending", warnings: [] },
  ]);
  expect(evidence.warnings).toEqual(["big.pdf exceeds 20 MB and was skipped.", "export.pdf: No summary.", "second-export.pdf is a LinkedIn export, but export.pdf is your profile; the export is used as reference text only.", "scan.pdf: The PDF has no extractable text.", "new.pdf has not been imported yet."]);
});

test("prefers the resume data file and keeps every export as reference text", () => {
  dataFile = DATA;
  const evidence = profileEvidence("/profile");
  expect(evidence.source).toEqual({ kind: "data", file: "resume-data.json" });
  expect(evidence.raw).toEqual({ name: "Dana Data", skills: ["ReactJs"] });
  expect((evidence.data!.profileSources as { references: { file: string }[] }).references.map(item => item.file)).toEqual(["export.pdf", "second-export.pdf", "focus.pdf"]);
  expect(evidence.assets[0]).toEqual({ file: "resume-data.json", kind: "data", status: "imported", warnings: [] });
});

test("reports an unreadable data file and returns the profile without references as is", () => {
  dataFile = "{";
  const broken = profileEvidence("/profile");
  expect(broken.assets[0]).toMatchObject({ file: "resume-data.json", kind: "data", status: "failed" });
  expect(broken.warnings[1]).toMatch(/^resume-data\.json: Invalid resume data/);
  expect(broken.source?.kind).toBe("linkedin");
  dataFile = DATA;
  vi.mocked(profileAssets).mockReturnValue({ assets: [], warnings: [] });
  expect(profileEvidence("/profile")).toEqual({ data: { name: "Dana Data", skills: ["React"] }, raw: { name: "Dana Data", skills: ["ReactJs"] }, source: { kind: "data", file: "resume-data.json" }, warnings: [], assets: [{ file: "resume-data.json", kind: "data", status: "imported", warnings: [] }] });
  vi.mocked(fs.existsSync).mockReturnValue(false);
  expect(profileEvidence("/missing")).toEqual({ data: null, raw: null, source: null, warnings: [], assets: [] });
});
