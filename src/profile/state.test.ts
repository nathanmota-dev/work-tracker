import { expect, test, vi } from "vitest";
import { sourcesConfig } from "../preparation/sources.ts";
import type { ResumeSourcesConfig } from "../preparation/types.ts";
import { profileEvidence } from "./evidence.ts";
import { profileSourcesState } from "./state.ts";

vi.mock("../preparation/sources.ts", async (original) => ({ ...(await original<typeof import("../preparation/sources.ts")>()), sourcesConfig: vi.fn() }));
vi.mock("./evidence.ts", () => ({ profileEvidence: vi.fn() }));

const config = (fields: Partial<ResumeSourcesConfig>): ResumeSourcesConfig => ({ projectDir: "/latex", mainFile: "resume.tex", dataFile: "", engine: "pdflatex", profileDir: "/profile", ...fields });
const role = { company: "Northwind Labs", title: "Engineer", start: "2022-12", end: "Present", highlights: [] };

test("reads the profile, its details and its experience from the structured source", () => {
  vi.mocked(sourcesConfig).mockReturnValue(config({}));
  const data = { name: "Alex Example", skills: ["React"], work: [role], profileSources: { references: [{ file: "cv.pdf", text: "alex@resume.example" }] } };
  vi.mocked(profileEvidence).mockReturnValue({ data, raw: data, source: { kind: "linkedin", file: "export.pdf" }, warnings: ["new.pdf has not been imported yet."], assets: [{ file: "new.pdf", kind: null, status: "pending", warnings: [] }] });
  expect(profileSourcesState()).toEqual({
    profileDir: "/profile", source: { kind: "linkedin", file: "export.pdf" }, warnings: ["new.pdf has not been imported yet."],
    assets: [{ file: "new.pdf", kind: null, status: "pending", warnings: [] }],
    personal: [{ key: "first_name", value: "Alex", source: "linkedin" }, { key: "last_name", value: "Example", source: "linkedin" }, { key: "full_name", value: "Alex Example", source: "linkedin" }, { key: "email", value: "alex@resume.example", source: "resume" }],
    about: { headline: "", summary: "", currentCompany: "Northwind Labs", skills: ["React"], languages: [], certifications: [] },
    resume: { experience: [{ title: "Engineer", organization: "Northwind Labs", start: "2022-12", end: "Present", location: "", bullets: [], skills: [] }], education: [] },
  });
  expect(profileEvidence).toHaveBeenCalledWith("/profile");
});

test("without a structured source only the reference PDFs fill personal details", () => {
  vi.mocked(profileEvidence).mockReturnValue({ data: { profileSources: { references: [{ file: "cv.pdf", text: "alex@resume.example" }] } }, raw: null, source: null, warnings: [], assets: [] });
  expect(profileSourcesState(config({}))).toEqual({ profileDir: "/profile", source: null, assets: [], warnings: [], personal: [{ key: "email", value: "alex@resume.example", source: "resume" }], about: null, resume: { experience: [], education: [] } });
});
