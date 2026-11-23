import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Database } from "../../db/sqlite.ts";
import { migrateDatabase } from "../../db/migrations.ts";
import { db } from "../../db/index.ts";
import { handleCompanyResearch } from "../../company-research/http.ts";
import { getCompanyResearch, invalidateCompanyResearch, listCompanyResearch, saveCompanyResearch } from "../../company-research/store.ts";

vi.mock("../../db/index.ts", () => ({ db: vi.fn() }));

const exec = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), "work-tracker-research-"));
const day = 86_400_000;
const start = new Date("2026-11-01T12:00:00.000Z");
const later = (days: number) => new Date(start.getTime() + days * day);
const sources = { website: { url: "https://example.com/about", notes: "Mission and values" }, media: { url: "https://example.com/news", notes: "Launch" } };
let d: Database;
beforeEach(() => {
  d = new Database(join(mkdtempSync(join(root, "store-")), "research.db"));
  migrateDatabase(d, { backupDir: join(root, "backups") });
  vi.mocked(db).mockReturnValue(d);
});
afterEach(() => d.close());
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("one entry per normalized company: trailing spaces and case match, legal suffixes do not", () => {
  saveCompanyResearch({ company: "Acme Corp", sources }, start);
  saveCompanyResearch({ company: "acme corp ", sources: { reviews: { url: "https://example.com/reviews" } }, summary: "Second pass" }, later(2));
  saveCompanyResearch({ company: "Acme Corp Ltd", sources }, start);
  expect(d.query("SELECT company_key, company_name FROM company_research ORDER BY id").all()).toEqual([
    { company_key: "acme-corp", company_name: "acme corp" },
    { company_key: "acme-corp-ltd", company_name: "Acme Corp Ltd" },
  ]);
  expect(getCompanyResearch("ACME CORP", { at: later(3) })?.entry).toMatchObject({ sources: { reviews: { url: "https://example.com/reviews", notes: null } }, summary: "Second pass", fetched_at: later(2).toISOString() });
  expect(listCompanyResearch(later(3)).map((row) => [row.company_key, row.age_days])).toEqual([["acme-corp", 1], ["acme-corp-ltd", 3]]);
});

test("the TTL expires after 30 days and stale entries are only read on request", () => {
  saveCompanyResearch({ company: "Acme Corp", sources }, start);
  expect(getCompanyResearch("Acme Corp", { at: later(29) })).toMatchObject({ fresh: true, ageDays: 29, entry: { company: "Acme Corp" } });
  expect(getCompanyResearch("Acme Corp", { at: later(30) })).toEqual({ fresh: false, ageDays: 30, entry: null });
  expect(getCompanyResearch("Acme Corp", { at: later(31), allowStale: true })).toMatchObject({ fresh: false, ageDays: 31, entry: { company: "Acme Corp" } });
});

test("credential and non-web URLs are refused without writing", () => {
  for (const url of ["https://user:secret@example.com/", "ftp://example.com/", "javascript:alert(1)"])
    expect(() => saveCompanyResearch({ company: "Acme Corp", sources: { website: { url } } })).toThrow(/http or https URL without credentials/);
  expect(d.query("SELECT COUNT(*) AS n FROM company_research").get()).toEqual({ n: 0 });
});

test("HTTP reads the age and Refresh invalidates the entry so the next lookup misses", async () => {
  saveCompanyResearch({ company: "Acme Corp", sources });
  const broadcast = vi.fn();
  const read = async () => (await handleCompanyResearch("/api/company-research", new Request("http://localhost/api/company-research?company=Acme%20Corp"), broadcast)).json();
  expect(await read()).toMatchObject({ found: true, fresh: true, age_days: 0 });
  const refresh = await handleCompanyResearch("/api/company-research/invalidate", new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ company: "acme corp" }) }), broadcast);
  expect(await refresh.json()).toEqual({ removed: true });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "company_research" });
  expect(await read()).toMatchObject({ found: false, entry: null });
  expect(invalidateCompanyResearch("Acme Corp")).toBe(false);
});

test("the CLI saves, reads fresh and stale entries, lists them and rejects unsafe sources", async () => {
  const home = mkdtempSync(join(root, "cli-"));
  const env = { ...process.env, WORK_TRACKER_HOME: home };
  const cli = (...args: string[]) => exec(process.execPath, [resolve("out/cli/work-tracker.cjs"), ...args], { env });
  const get = async (...args: string[]) => JSON.parse((await cli("company-research", "get", ...args)).stdout);
  const file = join(home, "research.json");
  writeFileSync(file, JSON.stringify({ sources, network_contacts_note: "Two first-degree contacts", summary: "Synthetic summary" }));
  expect((await cli("company-research", "save", "--company", "Acme Corp", "--file", file)).stdout).toContain('company research for "Acme Corp" cached as acme-corp');
  expect(await get("--company", "acme corp ")).toMatchObject({ found: true, fresh: true, age_days: 0, ttl_days: 30, entry: { network_contacts_note: "Two first-degree contacts" } });
  expect(await get("--company", "Acme Corp Ltd")).toEqual({ company_key: "acme-corp-ltd", found: false, fresh: false, age_days: null, ttl_days: 30, entry: null });
  const raw = new Database(join(home, "work-tracker.db"));
  raw.query("UPDATE company_research SET fetched_at = ?").run(new Date(Date.now() - 31 * day).toISOString());
  raw.close();
  expect(await get("--company", "Acme Corp")).toMatchObject({ found: true, fresh: false, age_days: 31, entry: null });
  expect(await get("--company", "Acme Corp", "--allow-stale")).toMatchObject({ fresh: false, entry: { summary: "Synthetic summary" } });
  expect(JSON.parse((await cli("company-research", "list")).stdout)).toEqual([expect.objectContaining({ company: "Acme Corp", fresh: false, sources: ["website", "media"] })]);
  writeFileSync(file, JSON.stringify({ sources: { website: { url: "https://user:pass@example.com/" } } }));
  await expect(cli("company-research", "save", "--company", "Acme Corp", "--file", file)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("without credentials") });
});
