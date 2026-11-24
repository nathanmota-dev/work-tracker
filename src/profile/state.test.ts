import { expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { sourcesConfig } from "../preparation/sources.ts";
import type { ResumeSourcesConfig } from "../preparation/types.ts";
import { profileEvidence } from "./evidence.ts";
import { profileSourcesState } from "./state.ts";
import type { LinkedInProfile } from "./types.ts";

vi.mock("../preparation/sources.ts", async (original) => ({ ...(await original<typeof import("../preparation/sources.ts")>()), sourcesConfig: vi.fn() }));
vi.mock("./evidence.ts", () => ({ profileEvidence: vi.fn() }));

const config = (fields: Partial<ResumeSourcesConfig>): ResumeSourcesConfig => ({ projectDir: "/latex", mainFile: "resume.tex", dataFile: "", engine: "pdflatex", profileDir: "", ...fields });
const role = { company: "Northwind Labs", title: "Engineer", start: "2022-12", end: "Present", location: "", bullets: [] };

test("lists the data file and the folder's PDFs with the extracted experience", () => {
  vi.mocked(sourcesConfig).mockReturnValue(config({ dataFile: "/profile/resume-data.json", profileDir: "/profile" }));
  vi.mocked(fs.readFileSync).mockReturnValue('{"skills":["ReactJs"]}');
  vi.mocked(profileEvidence).mockReturnValue({ data: null, warnings: ["new.pdf has not been imported yet."], assets: [{ file: "new.pdf", kind: null, status: "pending", warnings: [] }], conflicts: [], linkedin: { experience: [role], education: [{}], topSkills: ["React", "Go"], languages: [] } as unknown as LinkedInProfile });
  expect(profileSourcesState()).toEqual({
    profileDir: "/profile", dataFile: "/profile/resume-data.json", conflicts: [], warnings: ["new.pdf has not been imported yet."],
    assets: [{ file: "resume-data.json", kind: "data", status: "imported", warnings: [] }, { file: "new.pdf", kind: null, status: "pending", warnings: [] }],
    linkedin: { experiences: 1, education: 1, skills: 2, languages: 0, entries: [role] },
    personal: [], about: { headline: "", summary: "", currentCompany: "Northwind Labs", skills: ["React", "Go"], languages: [], certifications: [] },
  });
  expect(profileEvidence).toHaveBeenCalledWith("/profile", { skills: ["React"] });
});

test("reports an unreadable data file and a configuration without a profile folder", () => {
  vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error("ENOENT: missing"), { code: "ENOENT" }); });
  expect(profileSourcesState(config({ dataFile: "/data/resume-data.json" }))).toEqual({
    profileDir: "", dataFile: "/data/resume-data.json", linkedin: null, conflicts: [], personal: [], about: null,
    assets: [{ file: "resume-data.json", kind: "data", status: "failed", warnings: ["The resume data file does not exist."] }],
    warnings: ["resume-data.json: The resume data file does not exist."],
  });
  vi.mocked(fs.readFileSync).mockReturnValue("export const RESUME_DATA = {};");
  expect(profileSourcesState(config({ dataFile: "/data/resume-data.ts" })).assets[0]!.warnings[0]).toContain("TypeScript resume data is no longer supported");
  vi.mocked(profileEvidence).mockReturnValue({ data: null, warnings: [], assets: [], conflicts: [], linkedin: null });
  expect(profileSourcesState(config({ profileDir: "/profile" }))).toMatchObject({ assets: [], linkedin: null });
  expect(profileEvidence).toHaveBeenLastCalledWith("/profile", null);
});
