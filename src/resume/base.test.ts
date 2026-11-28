import * as fs from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { profileEvidence } from "../profile/evidence.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import { baseResumeLatex, editedAnswers, withEditedAnswers, writeBaseResume } from "./base.ts";
import type { ResumeDocument } from "./document.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
vi.mock("../paths.ts", () => ({ paths: { profile: "/home/profile", baseResume: "/home/resume" } }));
vi.mock("../profile/evidence.ts", () => ({ profileEvidence: vi.fn() }));

let d: Database;
const files = new Map<string, string>();
const profile = { name: "Ada Example", location: "Campinas, SP", summary: "From the file.", contact: { email: "ada@file.example", tel: "(19) 1111-1111", social: [{ name: "LinkedIn", url: "https://www.linkedin.com/in/ada/" }] }, personalWebsiteUrl: "https://ada.example" };
function answer(key: string, value: string, filled?: string) {
  d.query("INSERT INTO applicant_answers (key, value, category, updated_at) VALUES (?, ?, 'contact', 'now')").run(key, value);
  if (filled !== undefined) d.query("INSERT INTO answer_autofill (key, source, value, applied_at) VALUES (?, 'data', ?, 'now')").run(key, filled);
}
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  files.clear();
  vi.mocked(profileEvidence).mockReturnValue({ data: profile, raw: profile, source: { kind: "data", file: "resume-data.json" }, warnings: [], assets: [] });
  vi.mocked(fs.existsSync).mockImplementation(path => files.has(String(path)));
  vi.mocked(fs.readFileSync).mockImplementation(((path: string) => files.get(String(path))!) as unknown as typeof fs.readFileSync);
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.writeFileSync).mockImplementation((path, text) => { files.set(String(path), String(text)); });
  vi.mocked(fs.rmSync).mockImplementation(path => { files.delete(String(path)); });
});

test("only answers the user changed in Profile override the profile; filled ones follow it", () => {
  answer("email", "ada@file.example", "ada@file.example");
  answer("phone", "(19) 2222-2222", "(19) 1111-1111");
  answer("full_name", "Ada Q. Example");
  answer("summary", "  ");
  answer("first_name", "Ada");
  expect(editedAnswers()).toEqual({ phone: "(19) 2222-2222", full_name: "Ada Q. Example" });
});

test("edited links replace the profile's link of the same site or its website, or are added", () => {
  const doc: ResumeDocument = { name: "Ada", contact: { location: "A", phone: "1", email: "a@x.example" }, links: ["https://www.linkedin.com/in/ada/", "https://ada.example"], summary: "S", education: [], skills: [], work: [], projects: [], certifications: [] };
  expect(withEditedAnswers(doc, {})).toEqual(doc);
  expect(withEditedAnswers(doc, { linkedin_url: "https://www.linkedin.com/in/ada-new/", github_url: "https://github.com/ada", portfolio_url: "https://new.example", location: "B", summary: "T", full_name: "Ada Q." })).toEqual({
    ...doc, name: "Ada Q.", summary: "T", contact: { location: "B", phone: "1", email: "a@x.example" },
    links: ["https://www.linkedin.com/in/ada-new/", "https://new.example", "https://github.com/ada"],
  });
  expect(withEditedAnswers({ ...doc, links: [] }, { portfolio_url: "https://new.example" }).links).toEqual(["https://new.example"]);
});

test("renders the profile with the edited details and writes the file only when it changed", () => {
  answer("phone", "(19) 2222-2222", "(19) 1111-1111");
  const tex = baseResumeLatex()!;
  expect(tex).toContain("\\small Campinas, SP $|$ (19) 2222-2222 $|$ \\href{mailto:ada@file.example}{ada@file.example} \\\\");
  expect(tex).toContain("\\small{From the file.}");
  expect(writeBaseResume()).toBe(tex);
  expect(fs.mkdirSync).toHaveBeenCalledWith("/home/resume", { recursive: true, mode: 0o700 });
  expect(files.get("/home/resume/resume.tex")).toBe(tex);
  vi.mocked(fs.writeFileSync).mockClear();
  writeBaseResume();
  expect(fs.writeFileSync).not.toHaveBeenCalled();
  expect(profileEvidence).toHaveBeenCalledWith("/home/profile");
});

test("without a profile there is no base resume and its old file is removed", () => {
  files.set("/home/resume/resume.tex", "old");
  vi.mocked(profileEvidence).mockReturnValue({ data: null, raw: null, source: null, warnings: [], assets: [] });
  expect(baseResumeLatex()).toBeNull();
  expect(() => writeBaseResume()).toThrow("Upload your resume data or LinkedIn PDF in Profile to build your base resume.");
  expect(files.has("/home/resume/resume.tex")).toBe(false);
});
