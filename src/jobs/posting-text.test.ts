import { expect, test } from "vitest";
import { postingText } from "./posting-text.ts";

const page = [
  "Example Corp", "", "Backend Engineer", "", "Remote", "Apply", "Save", "Try Premium for R$0", "",
  "About the job", "", "Build APIs with Node.js and PostgreSQL.", "", "", "", "Requirements: TypeScript", "… more", "",
  "Set alert for similar jobs", "About the company", "Example Corp", "10,000 followers",
].join("\n");

test("keeps only the posting body of a LinkedIn job page", () => {
  expect(postingText({ url: "https://www.linkedin.com/jobs/view/1/", sections: { job_posting: page } }))
    .toBe("Build APIs with Node.js and PostgreSQL.\n\nRequirements: TypeScript");
});

test("cuts at the earliest page section and reads Portuguese headings", () => {
  const text = "Topo\nSobre a vaga\nVaga com React.\nSobre a empresa\nEmpresa\nSet alert for similar jobs";
  expect(postingText({ sections: { job_posting: text } })).toBe("Vaga com React.");
});

test("reads other result shapes and keeps text without known headings whole", () => {
  expect(postingText({ description: "Plain posting text." })).toBe("Plain posting text.");
  expect(postingText(JSON.stringify({ job_description: "From JSON." }))).toBe("From JSON.");
  expect(postingText({ content: [{ text: "Block one" }, { text: "Block two" }] })).toBe("Block one\n\nBlock two");
});

test("returns nothing for empty results and sign-in notices", () => {
  for (const value of [null, undefined, "", { sections: { job_posting: "   " } }, { raw: "" }])
    expect(postingText(value)).toBe("");
  expect(postingText({ sections: { job_posting: "LinkedIn login in progress. Finish signing in." } })).toBe("");
  expect(postingText("Sign-in to LinkedIn is pending")).toBe("");
});
