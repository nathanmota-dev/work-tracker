import { expect, test } from "vitest";
import { profileResume } from "./resume.ts";
import type { LinkedInProfile, ProfileConflict } from "./types.ts";

const linkedin = (fields: Partial<LinkedInProfile>): LinkedInProfile => ({
  name: "", contact: { email: "", phone: "", linkedin: "", github: "", website: "" }, headline: "", location: "", summary: "",
  topSkills: [], languages: [], certifications: [], publications: [], experience: [], education: [], warnings: [], ...fields,
});
const role = (company: string, title: string, start: string, end: string, bullets: string[] = []) => ({ company, title, start, end, location: "", bullets });

test("completes data entries with the matching LinkedIn role and keeps the roles only LinkedIn has, newest first", () => {
  const data = {
    work: [
      { company: "Northwind Labs", start: "2024-11", end: "2025-07", techStack: ["PHP"] },
      { company: "Northwind Labs", start: "2025-07", end: "Present" },
    ],
    education: [{ school: "State University", degree: "BSc Information Systems", start: "2019-08", end: "2025-08" }],
  };
  const profile = linkedin({
    experience: [
      role("Northwind Labs", "Full-Stack Developer", "2025-07", "Present", ["Angular features"]),
      role("Northwind Labs", "Developer", "2024-11", "2025-07", ["PHP modernization"]),
      role("Contoso Research", "Researcher", "2024-02", "2025-08"),
    ],
    education: [{ school: "State University", degree: "", start: "2019", end: "2025" }, { school: "Technical School", degree: "IT Technician", start: "2015", end: "2016" }],
  });
  const resume = profileResume(data, profile, []);
  expect(resume.experience.map(entry => [entry.organization, entry.title, entry.start, entry.end, entry.source])).toEqual([
    ["Northwind Labs", "Full-Stack Developer", "2025-07", "Present", "both"],
    ["Northwind Labs", "Developer", "2024-11", "2025-07", "both"],
    ["Contoso Research", "Researcher", "2024-02", "2025-08", "linkedin"],
  ]);
  expect(resume.experience[1]).toMatchObject({ bullets: ["PHP modernization"], skills: ["PHP"] });
  expect(resume.education.map(entry => [entry.organization, entry.title, entry.source])).toEqual([
    ["State University", "BSc Information Systems", "both"],
    ["Technical School", "IT Technician", "linkedin"],
  ]);
});

test("applies decided conflicts and keeps the data value while a conflict is undecided", () => {
  const conflict = (chosen: ProfileConflict["chosen"], field = "work.start"): ProfileConflict => ({ key: field, field, label: "Northwind Labs · Engineer: start date", values: { data: "2022-01", linkedin: "2022-03" }, chosen });
  const data = { work: [{ company: "Northwind Labs", title: "Engineer", start: "2022-01", end: "Present", highlights: ["Built things"] }] };
  const profile = linkedin({ experience: [role("Northwind Labs", "Engineer", "2022-03", "Present")] });
  expect(profileResume(data, profile, [conflict("linkedin")]).experience[0]).toMatchObject({ start: "2022-03", bullets: ["Built things"] });
  expect(profileResume(data, profile, [conflict(null)]).experience[0]!.start).toBe("2022-01");
});

test("reads the data file alone and ignores malformed entries", () => {
  expect(profileResume({ work: [null, "x", {}, { position: "Analyst", name: "Fabrikam", startDate: "2020-05-10", summary: "Reports" }], education: "none" }, null, [])).toEqual({
    experience: [{ title: "Analyst", organization: "Fabrikam", start: "2020-05", end: "", location: "", bullets: ["Reports"], skills: [], source: "data" }],
    education: [],
  });
  expect(profileResume(null, null, [])).toEqual({ experience: [], education: [] });
});

test("matches bare data entries by a distinctive word and drops a second entry for a role already shown", () => {
  const data = { work: [
    { company: "Northwind Labs", start: "2025", end: "Present" },
    { company: "Northwind Labs", start: "2024", end: "2025" },
    { company: "X-RAT - FAPEMIG", start: "2024", end: "2025" },
    { company: "Young Coders - UFU", start: "2024", end: "2024" },
  ] };
  const profile = linkedin({ experience: [
    role("Northwind Labs", "Developer", "2024-11", "Present"),
    role("Gerais", "Full Stack Developer", "2024-03", "2025-10", ["Worked on the X-RAT platform"]),
    role("Universidade Federal de Uberlândia - UFU", "Instructor", "2024-07", "2024-12"),
  ] });
  expect(profileResume(data, profile, []).experience.map(entry => [entry.organization, entry.title, entry.start, entry.end])).toEqual([
    ["Northwind Labs", "Developer", "2025", "Present"],
    ["Young Coders - UFU", "Instructor", "2024-07", "2024-12"],
    ["X-RAT - FAPEMIG", "Full Stack Developer", "2024-03", "2025-10"],
  ]);
});
