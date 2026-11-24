import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { profileAssets } from "./assets.ts";
import { isFolder, profileEvidence } from "./evidence.ts";
import { cachedImports, profileChoices } from "./store.ts";
import type { LinkedInProfile, ProfileImport, ProfileSources } from "./types.ts";

vi.mock("./assets.ts", () => ({ profileAssets: vi.fn() }));
vi.mock("./store.ts", () => ({ cachedImports: vi.fn(), profileChoices: vi.fn() }));

const profile = { experience: [{ company: "Northwind Labs", title: "Engineer", start: "2022-12", end: "Present", location: "", bullets: [] }], education: [] } as unknown as LinkedInProfile;
const stored = (hash: string, fields: Partial<ProfileImport>): ProfileImport => ({ hash, kind: "reference", file: hash, parserVersion: 1, profile: null, text: "Resume", warnings: [], ...fields });
beforeEach(() => {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.spyOn(fs, "statSync").mockReturnValue({ isDirectory: () => true } as fs.Stats);
  vi.mocked(profileChoices).mockReturnValue(new Map());
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

test("consolidates the imported PDFs and reports pending, failed and undecided ones", () => {
  const evidence = profileEvidence("/profile", { work: [{ company: "Northwind Labs", start: "2022-11" }] });
  const sources = evidence.data!.profileSources as ProfileSources;
  expect(sources.linkedin).toBe(profile);
  expect(sources.references).toEqual([{ file: "second-export.pdf", text: "Older export" }, { file: "focus.pdf", text: "Resume" }]);
  expect(evidence.linkedin).toBe(profile);
  expect(evidence.conflicts).toHaveLength(1);
  expect(evidence.assets).toEqual([
    { file: "export.pdf", kind: "linkedin", status: "imported", warnings: ["No summary."] },
    { file: "second-export.pdf", kind: "linkedin", status: "imported", warnings: [] },
    { file: "focus.pdf", kind: "reference", status: "imported", warnings: [] },
    { file: "scan.pdf", kind: "reference", status: "failed", warnings: ["The PDF has no extractable text."] },
    { file: "new.pdf", kind: null, status: "pending", warnings: [] },
  ]);
  expect(evidence.warnings).toEqual(["big.pdf exceeds 20 MB and was skipped.", "export.pdf: No summary.", "scan.pdf: The PDF has no extractable text.", "new.pdf has not been imported yet.", "1 profile conflict needs a decision."]);
});

test("counts undecided conflicts and keeps the data as is without PDF evidence", () => {
  const data = { work: [{ company: "Northwind Labs", start: "2022-11", end: "2023-01" }] };
  expect(profileEvidence("/profile", data).warnings.at(-1)).toBe("2 profile conflicts need a decision.");
  vi.mocked(profileAssets).mockReturnValue({ assets: [], warnings: [] });
  expect(profileEvidence("/profile", data)).toEqual({ data, warnings: [], assets: [], linkedin: null, conflicts: [] });
  vi.mocked(fs.existsSync).mockReturnValue(false);
  expect(profileEvidence("/missing", data)).toEqual({ data, warnings: ["The profile folder does not exist. Select a folder or leave it empty."], assets: [], linkedin: null, conflicts: [] });
});
