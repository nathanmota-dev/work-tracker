import { expect, test } from "vitest";
import { linkedinData } from "./linkedin-data.ts";
import type { LinkedInProfile } from "./types.ts";

const profile: LinkedInProfile = {
  name: "Ada Example", headline: "Developer", location: "Campinas, SP", summary: "Builds things.", publications: [], warnings: [],
  contact: { email: "ada@example.com", phone: "+55 19 90000-0000", linkedin: "https://www.linkedin.com/in/ada", github: "", website: "https://ada.example" },
  topSkills: ["React"], languages: [{ name: "English", level: "Fluent" }], certifications: ["Cert"],
  experience: [{ company: "Northwind", title: "Developer", start: "2024-01", end: "Present", location: "Remote", bullets: ["Did things."] }],
  education: [{ school: "State University", degree: "BSc", start: "2019", end: "2023" }],
};

test("puts a LinkedIn export in the resume data file's shape", () => {
  expect(linkedinData(profile)).toEqual({
    name: "Ada Example", headline: "Developer", location: "Campinas, SP", summary: "Builds things.", personalWebsiteUrl: "https://ada.example",
    contact: { email: "ada@example.com", tel: "+55 19 90000-0000", social: [{ name: "LinkedIn", url: "https://www.linkedin.com/in/ada" }] },
    skills: ["React"], languages: [{ name: "English", level: "Fluent" }], certifications: ["Cert"],
    work: [{ company: "Northwind", title: "Developer", location: "Remote", start: "2024-01", end: "Present", highlights: ["Did things."] }],
    education: [{ school: "State University", degree: "BSc", start: "2019", end: "2023" }],
  });
  expect(linkedinData({ ...profile, contact: { ...profile.contact, website: "" } })).not.toHaveProperty("personalWebsiteUrl");
});
