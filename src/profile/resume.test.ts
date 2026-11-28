import { expect, test } from "vitest";
import { profileResume } from "./resume.ts";

test("lists the data entries newest first, current roles on top, marking hidden ones", () => {
  const data = {
    work: [
      { company: "Northwind Labs", title: "Developer", start: "2024-11", end: "2025-07", techStack: ["PHP"], highlights: ["Modernized the app."] },
      { company: "Northwind Labs", title: "Full-Stack Developer", start: "2025-07", end: "Present" },
      { company: "Old Shop", title: "Assistant", start: "2015-11", end: "2016-10", hidden: true },
    ],
    education: [{ school: "Technical School", degree: "IT Technician", start: "2015", end: "2016" }, { school: "State University", degree: "BSc Information Systems", start: "2019-08", end: "08/2025", location: "Monte Carmelo, MG" }],
  };
  const resume = profileResume(data);
  expect(resume.experience).toEqual([
    { title: "Full-Stack Developer", organization: "Northwind Labs", start: "2025-07", end: "Present", location: "", bullets: [], skills: [] },
    { title: "Developer", organization: "Northwind Labs", start: "2024-11", end: "2025-07", location: "", bullets: ["Modernized the app."], skills: ["PHP"] },
    { title: "Assistant", organization: "Old Shop", start: "2015-11", end: "2016-10", location: "", bullets: [], skills: [], hidden: true },
  ]);
  expect(resume.education.map(entry => [entry.organization, entry.end, entry.location])).toEqual([["State University", "2025-08", "Monte Carmelo, MG"], ["Technical School", "2016", ""]]);
});

test("reads other field names and ignores malformed entries", () => {
  expect(profileResume({ work: [null, "x", {}, { position: "Analyst", name: "Fabrikam", startDate: "2020-05-10", summary: "Reports" }], education: "none" })).toEqual({
    experience: [{ title: "Analyst", organization: "Fabrikam", start: "2020-05", end: "", location: "", bullets: ["Reports"], skills: [] }],
    education: [],
  });
  expect(profileResume(null)).toEqual({ experience: [], education: [] });
});
