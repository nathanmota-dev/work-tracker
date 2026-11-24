/**
 * Requirement gates against real SQLite, the HTTP handlers and the compiled CLI:
 * the profile declared through the API, an extraction stored by `job gate`, the
 * verdicts reported by `job list` and /api/jobs without quotes, and the quotes
 * read back per job.
 */
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StoredGate } from "../../gates/types.ts";

const run = promisify(execFile);
const home = mkdtempSync(join(tmpdir(), "work-tracker-gates-"));
const previousEnv = { ...process.env };
process.env.WORK_TRACKER_HOME = home;
process.env.WORK_TRACKER_CLI = resolve("out/cli/work-tracker.cjs");
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let handle: (req: Request) => Promise<Response>;
const broadcast = vi.fn();

async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [process.env.WORK_TRACKER_CLI!, ...args], { env: process.env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}
const api = async <T>(path: string, body?: unknown) => (await (await handle(new Request(`http://localhost/api/${path}?token=secret`, body === undefined ? {} : {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
}))).json()) as T;
const silent = { requires_citizenship_or_pr: false, requires_clearance: false, names_permit_or_sponsors: false };
const extraction = (name: string, value: unknown) => {
  const file = join(home, `${name}.json`);
  writeFileSync(file, JSON.stringify(value));
  return file;
};
const job = (title: string, description: string) =>
  (db().query("INSERT INTO jobs (title, company_name, link, description) VALUES (?, 'Acme', ?, ?) RETURNING id").get(title, `https://jobs.example.test/${title}`, description) as { id: number }).id;

beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  const { createRequestHandler } = await import("../../server/index.ts");
  handle = createRequestHandler({ token: "secret", acp: { run: async () => {}, cancel: () => {} }, broadcast });
  db();
});
afterAll(() => {
  closeDb();
  rmSync(home, { recursive: true, force: true });
  process.env = previousEnv;
});

test("profile → job gate → job list: fail, flag and pass with quotes kept out of the lists", async () => {
  const russian = job("Russian", "Fluent Russian required.");
  const english = job("English", "Fluent English.");
  const spanish = job("Spanish", "Spanish speaker.");
  const untouched = job("Untouched", "No check yet.");
  const before = await cli("job", "gate", "--id", String(russian), "--file", extraction("before", { languages: [{ language: "Russian", bar_above_declared: true, quote: "Fluent Russian required." }], eligibility: silent }));
  expect(before.stdout).toContain(`job #${russian} requirements: pass (unverified)`);
  await api("gates/languages", { language: "Spanish", level: "Native" });
  expect((await cli("gates", "language", "save", "--language", "English", "--level", "B1/B2")).code).toBe(0);
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "jobs" });
  expect(await api("gates/jobs/" + russian)).toMatchObject({ gate: { verdict: "fail" } });

  const english_ = await cli("job", "gate", "--id", String(english), "--file", extraction("english", { languages: [{ language: "English", stated_bar: "fluent", bar_above_declared: true, quote: "Fluent English." }], eligibility: silent }));
  expect(english_.stdout).toContain("requirements: flag");
  const spanish_ = await cli("job", "gate", "--id", String(spanish), "--file", extraction("spanish", { languages: [{ language: "spanish", bar_above_declared: false, quote: "Spanish speaker." }], eligibility: silent }));
  expect(spanish_.stdout).toContain("requirements: pass");

  const listed = JSON.parse((await cli("job", "list")).stdout) as Record<string, unknown>[];
  const verdicts = Object.fromEntries(listed.map((row) => [row.title, row.gate_verdict]));
  expect(verdicts).toEqual({ Russian: "fail", English: "flag", Spanish: "pass", Untouched: "unchecked" });
  expect(listed.every((row) => !("gate_json" in row))).toBe(true);
  const jobs = await api<Record<string, unknown>[]>("jobs");
  expect(jobs.find((row) => row.id === russian)).toMatchObject({ gate_verdict: "fail", gate_unverified: false });
  expect(jobs.find((row) => row.id === untouched)).toMatchObject({ gate_verdict: "unchecked" });
  expect(JSON.stringify(jobs)).not.toMatch(/"(gate_json|findings|extraction|quote)"/);
  const { gate } = await api<{ gate: StoredGate }>(`gates/jobs/${russian}`);
  expect(gate.language.findings[0]).toEqual({ verdict: "fail", note: "Requires Russian, which is not in your languages.", quote: "Fluent Russian required." });
});

test("eligibility: citizenship fails, sponsorship passes, silence passes unverified; a missing quote is refused", async () => {
  const profile = await api<{ eligibility: string }>("gates/eligibility", { eligibility: "needs_permission" });
  expect(profile.eligibility).toBe("needs_permission");
  const store = async (name: string, eligibility: unknown) =>
    cli("job", "gate", "--id", String(job(name, "Posting")), "--file", extraction(name, { languages: [], eligibility }));
  expect((await store("Citizens", { ...silent, requires_citizenship_or_pr: true, quote: "Must be a citizen or permanent resident." })).stdout).toContain("requirements: fail");
  expect((await store("Sponsor", { ...silent, names_permit_or_sponsors: true, program_confirmed: true, quote: "We sponsor visas." })).stdout).toContain("requirements: pass\n");
  expect((await store("Silent", silent)).stdout).toContain("requirements: pass (unverified)");
  const refused = await store("NoQuote", { ...silent, requires_clearance: true });
  expect(refused.code).toBe(1);
  expect(refused.stderr).toContain('eligibility (requires_clearance is true) needs the literal posting text in "quote"');
  expect(db().query("SELECT gate_json FROM jobs WHERE title = 'NoQuote'").get()).toEqual({ gate_json: null });
  expect(JSON.parse((await cli("gates", "profile")).stdout)).toMatchObject({ eligibility: "needs_permission", languages: [{ language: "English" }, { language: "Spanish" }] });
});
