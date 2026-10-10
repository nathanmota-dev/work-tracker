import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { callTool } from "./linkedin.ts";
import {
  jobDetails,
  resolveCompanyUrn,
  searchJobs,
  searchPeople,
} from "./search.ts";
import { databaseDouble } from "../test/doubles.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
vi.mock("./linkedin.ts", () => ({ callTool: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  vi.mocked(callTool).mockReset();
});
test("company cache avoids network; uncached URNs and missing results are persisted", async () => {
  d.statement.get.mockReturnValueOnce({ urn_id: "42" });
  expect(await resolveCompanyUrn("Acme")).toBe("42");
  expect(callTool).not.toHaveBeenCalled();
  vi.mocked(callTool).mockResolvedValue({
    references: {
      about: [
        { kind: "other", value: "ignored" },
        { kind: "company_urn", value: "17" },
      ],
    },
  });
  expect(await resolveCompanyUrn("Beta")).toBe("17");
  expect(d.statement.run).toHaveBeenLastCalledWith("Beta", "17");
  vi.mocked(callTool).mockResolvedValue({});
  expect(await resolveCompanyUrn("Unknown")).toBeNull();
  expect(d.statement.run).toHaveBeenLastCalledWith("Unknown", null);
});
test("job and detail searches map arguments and retain explicit page counts", async () => {
  await searchJobs({ keywords: "TS" });
  expect(callTool).toHaveBeenLastCalledWith("search_jobs", {
    keywords: "TS",
    max_pages: 1,
  });
  await searchJobs({
    keywords: "node",
    location: "Brazil",
    workType: "remote",
    maxPages: 3,
  });
  expect(callTool).toHaveBeenLastCalledWith("search_jobs", {
    keywords: "node",
    location: "Brazil",
    work_type: "remote",
    max_pages: 3,
  });
  await jobDetails("job-1");
  expect(callTool).toHaveBeenLastCalledWith("get_job_details", {
    job_id: "job-1",
  });
});
test("people searches resolve company filters and omit unavailable URNs", async () => {
  d.statement.get.mockReturnValue({ urn_id: "42" });
  await searchPeople({
    keywords: "recruiter",
    company: "Acme",
    location: "Brazil",
  });
  expect(callTool).toHaveBeenLastCalledWith("search_people", {
    keywords: "recruiter",
    current_company: "42",
    location: "Brazil",
  });
  d.statement.get.mockReturnValue(undefined);
  vi.mocked(callTool).mockResolvedValue({});
  await searchPeople({ keywords: "recruiter", company: "Unknown" });
  expect(callTool).toHaveBeenLastCalledWith("search_people", {
    keywords: "recruiter",
  });
  await searchPeople({ keywords: "engineer" });
  expect(callTool).toHaveBeenLastCalledWith("search_people", {
    keywords: "engineer",
  });
});
test("lookup errors propagate and never write a failed cache entry", async () => {
  vi.mocked(callTool).mockRejectedValue(new Error("MCP failed"));
  await expect(resolveCompanyUrn("Acme")).rejects.toThrow("MCP failed");
  expect(d.statement.run).not.toHaveBeenCalled();
  await expect(searchJobs({ keywords: "x" })).rejects.toThrow("MCP failed");
});
