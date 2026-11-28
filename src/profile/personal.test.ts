import { expect, test } from "vitest";
import { aboutFromSources, fromResumeText, personalFromSources } from "./personal.ts";

const resume = "Alex Q. Example\n(16) 99993-6596 | alex@resume.example | linkedin.com/in/alex-pdf | github.com/alex-dev\n\nEXPERIENCE\nAcme 2019 – 2021 1234567890";
const values = (fields: ReturnType<typeof personalFromSources>) => Object.fromEntries(fields.map(field => [field.key, `${field.value} (${field.source})`]));

test("takes each field from the structured source first, then the resume PDFs", () => {
  const data = { name: "Alex  Data Example", summary: "Builds web platforms.", languages: [{ name: "English", level: "Native" }], contact: { email: "alex@data.example", tel: "", social: [{ name: "GitHub", url: "https://github.com/alex-data" }] }, locationLink: "https://www.google.com/maps/place/Ribeir%C3%A3o+Preto+-+SP", personalWebsiteUrl: "#" };
  expect(values(personalFromSources(data, "data", [{ text: resume }]))).toEqual({
    first_name: "Alex (data)", last_name: "Data Example (data)", full_name: "Alex Data Example (data)", email: "alex@data.example (data)", phone: "(16) 99993-6596 (resume)",
    location: "Ribeirão Preto - SP (data)", city: "Ribeirão Preto (data)", state: "SP (data)", summary: "Builds web platforms. (data)", languages: "English · Native (data)", linkedin_url: "https://www.linkedin.com/in/alex-pdf/ (resume)", github_url: "https://github.com/alex-data (data)",
  });
  const linkedin = { name: "Alex Example", location: "Lisbon, Portugal", personalWebsiteUrl: "https://alex.dev", contact: { email: "alex@linkedin.example", tel: "", social: [{ name: "LinkedIn", url: "https://www.linkedin.com/in/alex/" }] } };
  expect(values(personalFromSources(linkedin, "linkedin", []))).toMatchObject({ full_name: "Alex Example (linkedin)", city: "Lisbon (linkedin)", country: "Portugal (linkedin)", linkedin_url: "https://www.linkedin.com/in/alex/ (linkedin)", portfolio_url: "https://alex.dev (linkedin)" });
});

test("skips invalid values and single-word names; no source suggests nothing", () => {
  const data = { name: "Alex", location: { city: "Porto" }, contact: { email: "not-an-email", phone: "12" } };
  expect(values(personalFromSources(data, "data", []))).toEqual({ location: "Porto (data)" });
  expect(personalFromSources(null, null, [])).toEqual([]);
  expect(personalFromSources(data, null, [])).toEqual([]);
  expect(values(personalFromSources({ locationLink: "https://maps.example/maps/place/%E0%A4%A" }, "data", []))).toEqual({});
});

test("reads only the header of a resume PDF", () => {
  expect(fromResumeText(resume)).toEqual({ email: "alex@resume.example", phone: "(16) 99993-6596", linkedin_url: "https://www.linkedin.com/in/alex-pdf/", github_url: "https://github.com/alex-dev" });
  expect(fromResumeText(`${"\n".repeat(20)}late@example.com`)).toEqual({ email: "", phone: "", linkedin_url: "", github_url: "" });
});

test("summarizes the profile from the structured source", () => {
  const data = { headline: "Engineer", summary: "Builds web platforms.", work: [{ company: "Old", end: "2020" }, { company: "Northwind", end: "Present" }], skillGroups: [{ name: "Back-End", items: ["Go"] }], techStack: ["TypeScript", "Go"], skills: ["SQL", 3], languages: [{ name: "English", level: "Native" }, "Spanish", 4], certifications: ["Cloud"] };
  expect(aboutFromSources(data)).toEqual({
    headline: "Engineer", summary: "Builds web platforms.", currentCompany: "Northwind", skills: ["Go", "SQL", "TypeScript"], languages: [{ name: "English", level: "Native" }, { name: "Spanish", level: "" }], certifications: ["Cloud"],
  });
  expect(aboutFromSources({ skills: ["React"] })).toMatchObject({ headline: "", skills: ["React"], currentCompany: "" });
  expect(aboutFromSources({ name: "Alex" })).toBeNull();
  expect(aboutFromSources(null)).toBeNull();
});

test("place parts split a location into city, state and country", async () => {
  const { placeParts } = await import("./personal.ts");
  expect(placeParts("Ribeirão Preto, São Paulo, Brazil")).toEqual({ city: "Ribeirão Preto", state: "São Paulo", country: "Brazil" });
  expect(placeParts("Ribeirão Preto - SP")).toEqual({ city: "Ribeirão Preto", state: "SP" });
  expect(placeParts("Porto, Portugal")).toEqual({ city: "Porto", country: "Portugal" });
  expect(placeParts("Remote")).toEqual({});
});

test("city, state and country come from the one source that gave the location", () => {
  const mixed = values(personalFromSources({ location: "Porto" }, "data", [{ text: "Lisbon, Portugal\nalex@resume.example" }]));
  expect(mixed).toMatchObject({ location: "Porto (data)", email: "alex@resume.example (resume)" });
  expect(mixed).not.toHaveProperty("country");
});
