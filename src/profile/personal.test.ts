import { expect, test } from "vitest";
import { EMPTY_CONTACT } from "./linkedin/contact.ts";
import { aboutFromSources, fromResumeText, personalFromSources } from "./personal.ts";
import type { LinkedInProfile } from "./types.ts";

const linkedin = (fields: Partial<LinkedInProfile> = {}): LinkedInProfile => ({
  name: "Alex Example", contact: { ...EMPTY_CONTACT, email: "alex@linkedin.example", linkedin: "https://www.linkedin.com/in/alex/", website: "https://alex.dev" },
  headline: "Engineer", location: "Lisbon, Portugal", summary: "Builds web platforms.", topSkills: ["TypeScript"], languages: [{ name: "English", level: "Native" }],
  certifications: ["Cloud"], publications: [], experience: [{ company: "Northwind", title: "Engineer", start: "2020", end: "Present", location: "", bullets: [] }], education: [], warnings: [], ...fields,
});
const resume = "Alex Q. Example\n(16) 99993-6596 | alex@resume.example | linkedin.com/in/alex-pdf | github.com/alex-dev\n\nEXPERIENCE\nAcme 2019 – 2021 1234567890";
const values = (fields: ReturnType<typeof personalFromSources>) => Object.fromEntries(fields.map(field => [field.key, `${field.value} (${field.source})`]));

test("takes each field from the data file first, then LinkedIn, then the resume PDFs", () => {
  const data = { name: "Alex  Data Example", contact: { email: "alex@data.example", tel: "", social: [{ name: "GitHub", url: "https://github.com/alex-data" }] }, locationLink: "https://www.google.com/maps/place/Ribeir%C3%A3o+Preto+-+SP", personalWebsiteUrl: "#" };
  expect(values(personalFromSources(data, linkedin(), [{ text: resume }]))).toEqual({
    first_name: "Alex (data)", last_name: "Data Example (data)", full_name: "Alex Data Example (data)", email: "alex@data.example (data)", phone: "(16) 99993-6596 (resume)",
    location: "Ribeirão Preto - SP (data)", linkedin_url: "https://www.linkedin.com/in/alex/ (linkedin)", github_url: "https://github.com/alex-data (data)", portfolio_url: "https://alex.dev (linkedin)",
  });
});

test("skips invalid values and single-word names; no source suggests nothing", () => {
  const data = { name: "Alex", location: { city: "Porto" }, contact: { email: "not-an-email", phone: "12" } };
  expect(values(personalFromSources(data, null, []))).toEqual({ location: "Porto (data)" });
  expect(personalFromSources(null, null, [])).toEqual([]);
  const partial = values(personalFromSources({ locationLink: "https://maps.example/maps/place/%E0%A4%A" }, linkedin({ contact: undefined as never, location: "" }), []));
  expect(partial).toEqual({ first_name: "Alex (linkedin)", last_name: "Example (linkedin)", full_name: "Alex Example (linkedin)" });
});

test("reads only the header of a resume PDF", () => {
  expect(fromResumeText(resume)).toEqual({ email: "alex@resume.example", phone: "(16) 99993-6596", linkedin_url: "https://www.linkedin.com/in/alex-pdf/", github_url: "https://github.com/alex-dev" });
  expect(fromResumeText(`${"\n".repeat(20)}late@example.com`)).toEqual({ email: "", phone: "", linkedin_url: "", github_url: "" });
});

test("summarizes the profile from LinkedIn and the data file's skills", () => {
  expect(aboutFromSources({ techStack: ["TypeScript", "Go"], skills: [{ name: "SQL" }, 3] }, linkedin())).toEqual({
    headline: "Engineer", summary: "Builds web platforms.", currentCompany: "Northwind", skills: ["TypeScript", "Go", "SQL"], languages: [{ name: "English", level: "Native" }], certifications: ["Cloud"],
  });
  expect(aboutFromSources({ skills: ["React"] }, null)).toMatchObject({ headline: "", skills: ["React"], currentCompany: "" });
  expect(aboutFromSources(null, null)).toBeNull();
});
