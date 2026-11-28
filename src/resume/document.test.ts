import { expect, test } from "vitest";
import { documentFromData } from "./document.ts";

const data = {
  name: " Ada Example ",
  location: "Campinas, SP",
  personalWebsiteUrl: "https://ada.example/",
  contact: { email: "ada@example.com", tel: "(19) 90000-0000", social: [{ name: "LinkedIn", url: "https://www.linkedin.com/in/ada/" }, { name: "Bad", url: "#" }] },
  summary: "Full-stack developer.",
  education: [{ school: "State University", location: "Campinas, SP", degree: "BSc", start: "2019-08", end: "08/2023" }, { school: "Old School", hidden: true }],
  skillGroups: [{ name: "Back-End", items: ["C#", ".NET"] }, { name: "Empty", items: [] }],
  skills: ["ignored when groups exist"],
  work: [
    { company: "Northwind", title: "Developer", start: "2024-01", end: "Present", techStack: ["Angular", "C#"], highlights: ["Built features."] },
    { company: "Contoso", title: "Intern", start: "2022", end: "2023", location: "Remote", highlights: [] },
    { company: "Hidden Co", hidden: true },
  ],
  projects: [
    { name: "Tracker", description: "Full-stack app", date: "2026-05", techStack: ["Next.js"], highlights: ["Imports bank data."] },
    { name: "Landing page", description: "Only a description", techStack: [] },
    { name: "Secret", hidden: true },
  ],
  certifications: ["AWS Cloud Practitioner"],
};

test("reads a resume data file with its texts as written, leaving hidden entries out", () => {
  const doc = documentFromData(data);
  expect(doc.name).toBe("Ada Example");
  expect(doc.contact).toEqual({ location: "Campinas, SP", phone: "(19) 90000-0000", email: "ada@example.com" });
  expect(doc.links).toEqual(["https://www.linkedin.com/in/ada/", "https://ada.example/"]);
  expect(doc.education).toEqual([{ school: "State University", location: "Campinas, SP", degree: "BSc", start: "2019-08", end: "2023-08" }]);
  expect(doc.skills).toEqual([{ name: "Back-End", items: ["C#", ".NET"] }]);
  expect(doc.work.map(role => [role.company, role.detail, role.highlights.length])).toEqual([["Northwind", "Angular, C#", 1], ["Contoso", "Remote", 0]]);
  expect(doc.projects).toEqual([
    { name: "Tracker", description: "Full-stack app", date: "2026-05", techStack: ["Next.js"], highlights: ["Imports bank data."] },
    { name: "Landing page", description: "", date: "", techStack: [], highlights: ["Only a description"] },
  ]);
  expect(doc.certifications).toEqual(["AWS Cloud Practitioner"]);
});

test("uses the flat skill list without groups and tolerates a sparse file", () => {
  expect(documentFromData({ skills: ["React", " ", "Node.js"] }).skills).toEqual([{ name: "", items: ["React", "Node.js"] }]);
  expect(documentFromData({ contact: "invalid", work: "invalid" })).toMatchObject({ name: "", links: [], work: [], skills: [] });
});
