import { expect, test } from "vitest";
import { parseResumeData } from "../preparation/sources.ts";
import { consolidateProfile, nameTokens, profileDate, sameDate, similarNames } from "./consolidate.ts";
import type { LinkedInExperience, LinkedInProfile, ProfileSources } from "./types.ts";

const role = (fields: Partial<LinkedInExperience>): LinkedInExperience => ({ company: "Northwind Labs", title: "Engineer", start: "2022-12", end: "Present", location: "", bullets: [], ...fields });
const linkedin = (experience: LinkedInExperience[], education: LinkedInProfile["education"] = []): LinkedInProfile => ({
  name: "Alex Example", headline: "", location: "", summary: "", topSkills: ["TypeScript"], languages: [], certifications: [], publications: [], experience, education, warnings: [],
});
const sources = (data: Record<string, unknown> | null) => data!.profileSources as ProfileSources;

test("normalizes company names and matches by token similarity or containment", () => {
  expect(nameTokens("Contoso Análise S.A. (Brasil) - Unidade Sul")).toEqual(["contoso", "analise"]);
  expect(nameTokens("Acme S/A")).toEqual(["acme"]);
  expect(nameTokens("Inc.")).toEqual(["inc"]);
  expect(similarNames("Northwind Labs Ltda.", "Northwind Labs")).toBe(true);
  expect(similarNames("Northwind", "Northwind Labs Europe")).toBe(true);
  expect(similarNames("Northwind Labs", "Contoso Labs")).toBe(false);
  expect(similarNames("", "Contoso")).toBe(false);
});

test("reads source dates and compares them at the precision both have", () => {
  expect(["2024-7", "2024-07-15", "07/2024", "2024", 2024, "current", "O momento", "July 2024", null].map(profileDate)).toEqual(["2024-07", "2024-07", "2024-07", "2024", "2024", "Present", "Present", "", ""]);
  expect(sameDate("2024", "2024-08")).toBe(true);
  expect(sameDate("2024-07", "2024-08")).toBe(false);
  expect(sameDate("2023-08", "2024")).toBe(false);
  expect(sameDate("Present", "2024-08")).toBe(false);
  expect(sameDate("Present", "Present")).toBe(true);
});

test("without PDF evidence the data is returned unchanged", () => {
  const data = { work: [{ company: "Northwind Labs" }] };
  expect(consolidateProfile(data, null, [], new Map())).toBe(data);
  expect(consolidateProfile(null, null, [], new Map())).toBeNull();
  expect(consolidateProfile(null, null, [{ file: "resume.pdf", text: "Resume" }], new Map())).toEqual({
    profileSources: { linkedin: null, linkedinOnly: [], references: [{ file: "resume.pdf", text: "Resume" }], conflicts: [], resolved: [] },
  });
});

test("compares a company with several roles through their earliest start and latest end", () => {
  const data = { name: "Alex", work: [{ company: "Northwind Labs Ltda", start: "2022-11", end: "present", location: "Lisbon" }, { company: "Fabrikam Studio", start: "2017", end: "2019-05", location: "Porto, Portugal" }] };
  const profile = linkedin([
    role({ title: "Senior Engineer", start: "2023-08", location: "Lisbon, Portugal" }), role({ end: "2023-07" }),
    role({ company: "Fabrikam Studio", start: "2017-03", end: "2019-05", location: "Braga, Portugal" }),
    role({ company: "Contoso Analytics", start: "2019-06", end: "2022-11" }),
  ]);
  const result = consolidateProfile(data, profile, [], new Map())!;
  expect(result.name).toBe("Alex");
  expect(result.work).toBe(data.work);
  const evidence = sources(result);
  expect(evidence.conflicts.map(({ field, label, values, chosen }) => ({ field, label, values, chosen }))).toEqual([
    { field: "work.start", label: "Northwind Labs Ltda: start date", values: { data: "2022-11", linkedin: "2022-12" }, chosen: null },
    { field: "work.location", label: "Fabrikam Studio: location", values: { data: "Porto, Portugal", linkedin: "Braga, Portugal" }, chosen: null },
  ]);
  expect(evidence.linkedinOnly.map(item => item.company)).toEqual(["Contoso Analytics"]);
  expect(evidence.resolved).toEqual([]);
});

test("a data entry with a title matches that role only; a period that does not overlap never matches", () => {
  const profile = linkedin([role({ title: "Staff Engineer", start: "2024-01" }), role({ title: "Engineer", start: "2021-02", end: "2023-12" }), role({ start: "2010-01", end: "2012-01" })]);
  const evidence = sources(consolidateProfile({ work: [{ company: "Northwind Labs", title: "Engineer", start: "2021-03", end: "2023-12" }, { company: "Northwind Labs", start: "2005", end: "2006" }, { company: "" }, "text"] }, profile, [], new Map()));
  expect(evidence.conflicts.map(conflict => [conflict.label, conflict.values])).toEqual([["Northwind Labs · Engineer: start date", { data: "2021-03", linkedin: "2021-02" }]]);
  expect(evidence.linkedinOnly.map(item => item.title)).toEqual(["Staff Engineer", "Engineer"]);
});

test("compares education by school and records the decided values", () => {
  const profile = linkedin([], [{ school: "Example University", degree: "BSc", start: "2013", end: "2017" }]);
  const data = { education: [{ school: "Example University", degree: "Computer Science", start: "2013-02", end: "2018-12" }] };
  const [conflict] = sources(consolidateProfile(data, profile, [], new Map())).conflicts;
  expect(conflict).toMatchObject({ field: "education.end", label: "Example University · Computer Science: end date", values: { data: "2018-12", linkedin: "2017" } });
  const decided = sources(consolidateProfile(data, profile, [], new Map([[conflict!.key, "linkedin"]])));
  expect(decided.conflicts[0]!.chosen).toBe("linkedin");
  expect(decided.resolved).toEqual([{ key: conflict!.key, field: "education.end", label: conflict!.label, source: "linkedin", value: "2017" }]);
});

test("a conflict key changes only when its values change, so a new PDF reopens only those conflicts", () => {
  const data = { work: [{ company: "Northwind Labs", start: "2022-11", end: "2024-01" }] };
  const keys = (profile: LinkedInProfile) => sources(consolidateProfile(data, profile, [], new Map())).conflicts.map(conflict => [conflict.field, conflict.key]);
  const before = keys(linkedin([role({ end: "2024-02" })]));
  const after = keys(linkedin([role({ end: "2024-03", bullets: ["New bullet."] })]));
  expect(before).toHaveLength(2);
  expect(after[0]).toEqual(before[0]);
  expect(after[1]![1]).not.toBe(before[1]![1]);
});

test("the consolidated profile survives the frozen batch round trip unchanged", () => {
  const data = parseResumeData('{"skills":["ReactJs"],"work":[{"company":"Northwind Labs","start":"2022-11","techStack":["Node"]}]}', ".json");
  const consolidated = consolidateProfile(data, linkedin([role({ bullets: ["Shipped."] })]), [{ file: "other.pdf", text: "Other resume" }], new Map());
  expect(parseResumeData(JSON.stringify(consolidated), ".json")).toEqual(consolidated);
});
