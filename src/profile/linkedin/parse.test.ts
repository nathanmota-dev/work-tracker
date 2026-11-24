import { expect, test } from "vitest";
import { ENGLISH_EXPORT, PORTUGUESE_EXPORT, bboxXhtml, type FixtureLine } from "../../test/linkedin-fixtures.ts";
import { parseBbox } from "./bbox.ts";
import { isLinkedInExport } from "./detect.ts";
import { parseLinkedInProfile } from "./parse.ts";

const pages = (fixture: FixtureLine[][], footer?: (page: number, total: number) => string) => parseBbox(bboxXhtml(fixture, footer));

test("extracts every role of an English export, across the page break and a company with several roles", () => {
  const profile = parseLinkedInProfile(pages(ENGLISH_EXPORT));
  expect(profile).toMatchObject({
    name: "Alex Example", headline: "Senior Engineer at Northwind Labs", location: "Lisbon, Portugal",
    summary: "Engineer building web platforms with TypeScript.",
    topSkills: ["TypeScript", "React"],
    languages: [{ name: "English", level: "Full Professional" }, { name: "Spanish", level: "Limited Working" }],
    certifications: ["Example Cloud Practitioner"], publications: ["Notes on Testing"], warnings: [],
  });
  expect(profile.experience).toEqual([
    { company: "Northwind Labs", title: "Senior Software Engineer", start: "2023-08", end: "Present", location: "Lisbon, Portugal", bullets: ["Led the billing migration to TypeScript.", "Built a design system."] },
    { company: "Northwind Labs", title: "Software Engineer", start: "2022-12", end: "2023-07", location: "", bullets: ["Implemented dashboards in React."] },
    { company: "Contoso Analytics", title: "Backend Developer", start: "2019-06", end: "2022-11", location: "Remote", bullets: ["Designed REST APIs."] },
    { company: "Fabrikam Studio", title: "Junior Developer", start: "2017-03", end: "2019-05", location: "", bullets: ["Maintained internal tools."] },
  ]);
  expect(profile.education).toEqual([
    { school: "Example University", degree: "Bachelor of Science, Computer Science", start: "2013", end: "2017" },
    { school: "Example Language School", degree: "English", start: "", end: "" },
  ]);
});

test("keeps the first-page sidebar out of the summary and the experience", () => {
  const profile = parseLinkedInProfile(pages(ENGLISH_EXPORT));
  const text = JSON.stringify([profile.summary, profile.experience, profile.name, profile.headline]);
  for (const sidebar of ["alex@example.com", "Full Professional", "Example Cloud Practitioner", "Notes on Testing", "Page 1 of 3"]) expect(text).not.toContain(sidebar);
});

test("recognizes a Portuguese export like the English one", () => {
  const exported = pages(PORTUGUESE_EXPORT, (page, total) => `Página ${page} de ${total}`);
  expect(isLinkedInExport(exported)).toBe(true);
  expect(parseLinkedInProfile(exported)).toMatchObject({
    name: "Alex Exemplo", headline: "Engenheiro de software", location: "", summary: "",
    topSkills: ["TypeScript"], languages: [{ name: "Português", level: "Nativo ou bilíngue" }],
    experience: [{ company: "Northwind Labs", title: "Engenheiro de Software Sênior", start: "2023-08", end: "Present", location: "Lisboa, Portugal", bullets: ["Liderou a migração do faturamento."] }],
    education: [{ school: "Universidade Exemplo", degree: "Bacharelado, Ciência da Computação", start: "2013", end: "2017" }],
  });
});

test("a PDF without the sidebar or the page footer is not a LinkedIn export", () => {
  expect(isLinkedInExport(pages([["Alex Example", "Experience", "Northwind Labs"]]))).toBe(false);
  expect(isLinkedInExport(pages([[["side", "Contact"], "Alex Example"]], () => ""))).toBe(false);
  expect(isLinkedInExport([])).toBe(false);
});

test("warns about an export without experience and keeps only the first 30 roles", () => {
  expect(parseLinkedInProfile(pages([[["side", "Contact"], "Alex Example"]])).warnings).toEqual(["No experience was found in the LinkedIn export."]);
  const roles = Array.from({ length: 31 }, (_, i) => [`Company ${i}`, "Engineer", `${2020 - i} - ${2021 - i}`]).flat();
  const profile = parseLinkedInProfile(pages([[["side", "Contact"], "Alex", "Experience", ...roles]]));
  expect(profile.experience).toHaveLength(30);
  expect(profile.experience[29]).toMatchObject({ company: "Company 29", start: "1991", end: "1992" });
  expect(profile.warnings).toEqual(["Only the first 30 experiences of the LinkedIn export were kept."]);
});
