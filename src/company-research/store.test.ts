import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { db } from "../db/index.ts";
import { describeLookup, getCompanyResearch, invalidateCompanyResearch, listCompanyResearch, researchAge, saveCompanyResearch } from "./store.ts";
import { CompanyResearchError } from "./sources.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn() }));

let d: ReturnType<typeof databaseDouble>;
beforeEach(() => { d = databaseDouble(); vi.mocked(db).mockReturnValue(d.asDatabase); });

const fetched = "2026-11-01T12:00:00.000Z";
const daysLater = (days: number, ms = 0) => new Date(Date.parse(fetched) + days * 86_400_000 + ms);
const row = (fetched_at = fetched) => ({
  company_name: "Acme Corp", company_key: "acme-corp", fetched_at,
  sources_json: '{"website":{"url":"https://example.com/","notes":"Mission"}}', network_note: "Two contacts", summary_md: "Summary",
});
const entry = { company: "Acme Corp", company_key: "acme-corp", fetched_at: fetched, sources: { website: { url: "https://example.com/", notes: "Mission" } }, network_contacts_note: "Two contacts", summary: "Summary" };

test.each([
  [0, 0, true, 0],
  [29, 0, true, 29],
  [30, -1, true, 29],
  [30, 0, false, 30],
  [31, 0, false, 31],
  [-2, 0, true, 0],
])("after %d days (+%d ms) the research is fresh=%s with age %d", (days, ms, fresh, ageDays) => {
  expect(researchAge(fetched, daysLater(days, ms))).toEqual({ fresh, ageDays });
});

test("an unreadable date is stale with an unknown age", () => {
  expect(researchAge("not a date", daysLater(0))).toEqual({ fresh: false, ageDays: null });
});

test("looks up by normalized key and reports a miss as null", () => {
  d.statement.get.mockReturnValueOnce(row());
  expect(getCompanyResearch(" ACME corp ", { at: daysLater(29) })).toEqual({ entry, fresh: true, ageDays: 29 });
  expect(d.statement.get).toHaveBeenLastCalledWith("acme-corp");
  d.statement.get.mockReturnValueOnce(undefined);
  expect(getCompanyResearch("Acme Corp Ltd")).toBeNull();
  expect(d.statement.get).toHaveBeenLastCalledWith("acme-corp-ltd");
});

test("withholds a stale entry unless stale reads are allowed", () => {
  d.statement.get.mockReturnValue(row());
  expect(getCompanyResearch("Acme Corp", { at: daysLater(31) })).toEqual({ entry: null, fresh: false, ageDays: 31 });
  expect(getCompanyResearch("Acme Corp", { at: daysLater(31), allowStale: true })).toEqual({ entry, fresh: false, ageDays: 31 });
});

test("saves a validated research as an upsert stamped with the clock", () => {
  const saved = saveCompanyResearch({
    company: " Acme Corp ", sources: { website: { url: "https://example.com/", notes: " Mission " } }, networkNote: " Two contacts ", summary: "Summary",
  }, new Date(fetched));
  expect(saved).toEqual(entry);
  expect(d.query.mock.calls[0]![0]).toMatch(/ON CONFLICT\(company_key\) DO UPDATE/);
  expect(d.statement.run).toHaveBeenCalledWith({
    $company_name: "Acme Corp", $company_key: "acme-corp", $fetched_at: fetched,
    $sources_json: JSON.stringify(entry.sources), $network_note: "Two contacts", $summary_md: "Summary",
  });
});

test.each([
  [{ company: " ", sources: { website: { url: "https://example.com" } } }, "company is required"],
  [{ company: 7 as unknown as string, sources: { website: { url: "https://example.com" } } }, "company is required"],
  [{ company: "Acme", sources: { website: { url: "https://user:pass@example.com" } } }, "without credentials"],
  [{ company: "Acme", sources: { website: { url: "file:///etc/passwd" } } }, "http or https"],
  [{ company: "Acme", sources: { website: { url: "https://example.com" } }, networkNote: 3 }, "network_contacts_note must be text"],
  [{ company: "Acme", sources: { website: { url: "https://example.com" } }, summary: "x".repeat(20_001) }, "summary is longer than 20000"],
])("rejects %j before writing", (input, message) => {
  expect(() => saveCompanyResearch(input)).toThrow(CompanyResearchError);
  expect(() => saveCompanyResearch(input)).toThrow(message);
  expect(d.statement.run).not.toHaveBeenCalled();
});

test("invalidates by key and says whether anything was removed", () => {
  d.statement.run.mockReturnValueOnce({ changes: 1, lastInsertRowid: 0 }).mockReturnValueOnce({ changes: 0, lastInsertRowid: 0 });
  expect(invalidateCompanyResearch("acme corp ")).toBe(true);
  expect(d.statement.run).toHaveBeenLastCalledWith("acme-corp");
  expect(invalidateCompanyResearch("Acme Corp")).toBe(false);
  expect(() => invalidateCompanyResearch("")).toThrow("company is required");
});

test("lists companies with age, freshness and source categories only", () => {
  d.statement.all.mockReturnValueOnce([row("2026-11-20T12:00:00.000Z"), row()]);
  expect(listCompanyResearch(daysLater(30))).toEqual([
    { company: "Acme Corp", company_key: "acme-corp", fetched_at: "2026-11-20T12:00:00.000Z", age_days: 11, fresh: true, sources: ["website"] },
    { company: "Acme Corp", company_key: "acme-corp", fetched_at: fetched, age_days: 30, fresh: false, sources: ["website"] },
  ]);
  expect(listCompanyResearch()).toEqual([]);
});

test("describes hits, withheld entries and misses in one JSON shape", () => {
  expect(describeLookup("Acme Corp", { entry, fresh: true, ageDays: 2 })).toEqual({ company_key: "acme-corp", found: true, fresh: true, age_days: 2, ttl_days: 30, entry });
  expect(describeLookup("Acme Corp", { entry: null, fresh: false, ageDays: 40 })).toMatchObject({ found: true, fresh: false, age_days: 40, entry: null });
  expect(describeLookup("Acme Corp Ltd", null)).toEqual({ company_key: "acme-corp-ltd", found: false, fresh: false, age_days: null, ttl_days: 30, entry: null });
});
