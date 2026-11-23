import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { notifyChange } from "../db/notify.ts";
import { getCompanyResearch, listCompanyResearch, saveCompanyResearch } from "../company-research/store.ts";
import { CompanyResearchError } from "../company-research/sources.ts";
import { cliSpies } from "../test/doubles.ts";
import { companyResearchCmd } from "./company-research.ts";

vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../company-research/store.ts", async (original) => ({
  ...(await original<typeof import("../company-research/store.ts")>()),
  getCompanyResearch: vi.fn(),
  listCompanyResearch: vi.fn(),
  saveCompanyResearch: vi.fn(),
}));

let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  vi.clearAllMocks();
  output = cliSpies();
});
const research = (value: unknown) => { vi.mocked(readFileSync).mockReturnValue(typeof value === "string" ? value : JSON.stringify(value)); return "/tmp/research.json"; };
const printed = () => JSON.parse(output.log.mock.calls.at(-1)![0]);

test("get prints freshness and age, honoring --allow-stale", async () => {
  vi.mocked(getCompanyResearch).mockReturnValueOnce({ entry: null, fresh: false, ageDays: 31 });
  await companyResearchCmd("get", { company: "Acme Corp" });
  expect(getCompanyResearch).toHaveBeenLastCalledWith("Acme Corp", { allowStale: false });
  expect(printed()).toEqual({ company_key: "acme-corp", found: true, fresh: false, age_days: 31, ttl_days: 30, entry: null });
  vi.mocked(getCompanyResearch).mockReturnValueOnce(null);
  await companyResearchCmd("get", { company: "Acme Corp Ltd", "allow-stale": true });
  expect(getCompanyResearch).toHaveBeenLastCalledWith("Acme Corp Ltd", { allowStale: true });
  expect(printed()).toMatchObject({ company_key: "acme-corp-ltd", found: false, fresh: false });
  expect(notifyChange).not.toHaveBeenCalled();
});

test("get without a company fails with the validation message", async () => {
  vi.mocked(getCompanyResearch).mockImplementationOnce(() => { throw new CompanyResearchError("company is required"); });
  await expect(companyResearchCmd("get", {})).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith("error: company is required");
});

test("save caches the research file under --company and notifies the UI", async () => {
  vi.mocked(saveCompanyResearch).mockReturnValue({ company: "Acme Corp", company_key: "acme-corp" } as never);
  const sources = { website: { url: "https://example.com", notes: "Mission" } };
  await companyResearchCmd("save", { company: "Acme Corp", file: research({ company: "Ignored", sources, network_contacts_note: "Two", summary: "S" }) });
  expect(saveCompanyResearch).toHaveBeenCalledWith({ company: "Acme Corp", sources, networkNote: "Two", summary: "S" });
  expect(output.log).toHaveBeenCalledWith('company research for "Acme Corp" cached as acme-corp');
  expect(notifyChange).toHaveBeenCalledWith("company_research");
});

test("save falls back to the company named in the file", async () => {
  vi.mocked(saveCompanyResearch).mockReturnValue({ company: "Globex", company_key: "globex" } as never);
  await companyResearchCmd("save", { file: research({ company: "Globex", sources: {} }) });
  expect(vi.mocked(saveCompanyResearch).mock.calls[0]![0]).toMatchObject({ company: "Globex" });
  await companyResearchCmd("save", { file: research({ company: 3, sources: {} }) });
  expect(vi.mocked(saveCompanyResearch).mock.calls[1]![0]).toMatchObject({ company: "" });
});

test.each([
  [{}, "error: missing required --file (research JSON to cache)"],
  [{ file: "x" }, "error: x must contain a JSON object with sources", "{broken"],
  [{ file: "x" }, "error: x must contain a JSON object with sources", "[]"],
  [{ file: "x" }, "error: x must contain a JSON object with sources", "null"],
])("save rejects %j without writing", async (flags, message, content?: string) => {
  if (content !== undefined) research(content);
  await expect(companyResearchCmd("save", flags)).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith(message);
  expect(saveCompanyResearch).not.toHaveBeenCalled();
});

test("save reports unreadable files, invalid research and unexpected failures", async () => {
  vi.mocked(readFileSync).mockImplementationOnce(() => { throw new Error("ENOENT: no such file"); });
  await expect(companyResearchCmd("save", { file: "/missing.json" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith("error: ENOENT: no such file");
  vi.mocked(saveCompanyResearch).mockImplementationOnce(() => { throw new CompanyResearchError("sources.website.url must be an http or https URL without credentials"); });
  await expect(companyResearchCmd("save", { company: "Acme", file: research({ sources: {} }) })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith("error: sources.website.url must be an http or https URL without credentials");
  vi.mocked(saveCompanyResearch).mockImplementationOnce(() => { throw new Error("disk"); });
  await expect(companyResearchCmd("save", { company: "Acme", file: research({ sources: {} }) })).rejects.toThrow("disk");
  expect(notifyChange).not.toHaveBeenCalled();
});

test("list prints the cached companies and unknown subcommands fail", async () => {
  vi.mocked(listCompanyResearch).mockReturnValueOnce([{ company: "Acme Corp", fresh: true }] as never);
  await companyResearchCmd("list", {});
  expect(printed()).toEqual([{ company: "Acme Corp", fresh: true }]);
  await expect(companyResearchCmd("bogus", {})).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith("error: unknown company-research subcommand: bogus");
});
