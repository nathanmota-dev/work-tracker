import { expect, test } from "vitest";
import { extractSearchRows, normalizeSearchJob, structuredSearchRows } from "./search-results.ts";

const job = { title: " Engineer ", company_name: " Synthetic ", job_id: 42 };
test("unwraps structured MCP envelopes and JSON blocks without parsing prose", () => {
  for (const key of ["structuredContent", "jobs", "people", "results", "data", "items", "elements"])
    expect(structuredSearchRows({ [key]: [job] })).toEqual([job]);
  expect(structuredSearchRows({ structuredContent: { jobs: [job] }, content: [{ text: "ignored" }] })).toEqual([job]);
  expect(structuredSearchRows({ jobs: [], content: [null, {}, { text: "Engineer at Synthetic" }, { text: "{}" }, { text: JSON.stringify({ results: [job] }) }] })).toEqual([job]);
  for (const value of [null, 3, "Engineer at Synthetic https://example.test", {}, { raw: "Engineer at Synthetic" }])
    expect(structuredSearchRows(value)).toEqual([]);
  expect(structuredSearchRows([null, "invalid", job])).toEqual([null, "invalid", job]);
  expect(extractSearchRows({ results: [] })).toEqual([]);
  expect(extractSearchRows({ structuredContent: { jobs: [] }, content: [{ text: "[]" }, { text: "{}" }] })).toEqual([]);
  expect(extractSearchRows({ raw: "prose" })).toBeUndefined();
});
test("normalizes supported aliases, nested company/location and numeric IDs", () => {
  expect(normalizeSearchJob(job)).toEqual({ job: { title: "Engineer", company_name: "Synthetic", source: "linkedin", status: "saved", linkedin_job_id: "42", link: "https://www.linkedin.com/jobs/view/42/" } });
  expect(normalizeSearchJob({ job_title: " Engineer ", company: { name: " Synthetic " }, id: " 42 ", job_url: "https://example.test/42", location: { name: " Remote " }, workType: " remote ", job_description: " Build ", salary: " 100k " }).job).toMatchObject({ title: "Engineer", company_name: "Synthetic", linkedin_job_id: "42", link: "https://example.test/42", location: "Remote", work_type: "remote", description: "Build", comp: "100k" });
  expect(normalizeSearchJob({ ...job, linkedin_job_id: "42", url: "https://linkedin.com/jobs/view/42", company: "ignored", work_type: "hybrid", comp: "USD", description: "Details", location: "Brazil" }).job).toMatchObject({ work_type: "hybrid", comp: "USD", location: "Brazil" });
  expect(normalizeSearchJob({ title: "Role", company: "Corp", link: "https://example.test/role", location: null, description: "" }).job).toBeTruthy();
  expect(normalizeSearchJob({ title: "Role", company: "Corp", id: null, link: "https://linkedin.com/jobs/view/99" }).job).toBeTruthy();
});
test("invalid or text-only results are explicitly not savable", () => {
  const invalid = [null, [], 42, "Engineer at Synthetic", {}, { title: "Role", company: {} },
    { title: "Role", company: "Corp" }, { ...job, title: " " }, { ...job, location: {} },
    { ...job, url: "javascript:bad" }, { ...job, link: "https://user:secret@example.test" },
    { ...job, job_id: 0 }, { ...job, job_id: -1 }, { ...job, job_id: 1.5 },
    { ...job, job_id: Number.MAX_SAFE_INTEGER + 1 }, { ...job, job_id: {} }, { ...job, job_id: " " },
    { ...job, link: "https://linkedin.com/jobs/view/99" }];
  for (const value of invalid) expect(normalizeSearchJob(value)).toEqual({ job: null, error: expect.any(String) });
});
