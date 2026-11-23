/**
 * Batch triage against real SQLite, the HTTP handlers and the compiled CLI: the
 * skill's `ranking candidates` → `ranking save` → `ranking list` loop, progress
 * kept per job, deferral beyond the limit, the give-up rule and `--all`.
 */
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RankingCandidates } from "../../rankings/candidates.ts";
import type { RankingView } from "../../rankings/list.ts";
import type { JobRanking } from "../../rankings/types.ts";

const run = promisify(execFile);
const home = mkdtempSync(join(tmpdir(), "work-tracker-rankings-"));
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
const json = async <T>(...args: string[]) => JSON.parse((await cli(...args)).stdout) as T;
const api = async <T>(path: string) => (await (await handle(new Request(`http://localhost/api/${path}${path.includes("?") ? "&" : "?"}token=secret`))).json()) as T;
function result(jobId: number, value: unknown): string {
  const directory = join(home, "artifacts", "rankings");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${jobId}.json`), JSON.stringify(value));
  return join(directory, `${jobId}.json`);
}
const save = (jobId: number, value: unknown) => cli("ranking", "save", "--job-id", String(jobId), "--file", result(jobId, value));
const scored = (technical: number, experience: number, career: number) =>
  ({ status: "scored", scores: { technical, experience, career }, strengths: ["Matches the core stack"], gaps: ["No Kubernetes experience"] });
function job(title: string, fields: Record<string, string | null> = {}): number {
  const values = { title, company_name: "Example Corp", link: `https://jobs.example.test/${encodeURIComponent(title)}`, description: `${title} posting`, ...fields };
  const columns = Object.keys(values);
  return (db().query(`INSERT INTO jobs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`).get(...Object.values(values)) as { id: number }).id;
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  const { createRequestHandler } = await import("../../server/index.ts");
  handle = createRequestHandler({ token: "secret", acp: { run: async () => {}, cancel: () => {} }, broadcast });
  db();
});
beforeEach(() => {
  db().exec("DELETE FROM job_rankings; DELETE FROM applications; DELETE FROM jobs;");
});
afterAll(() => {
  closeDb();
  rmSync(home, { recursive: true, force: true });
  process.env = previousEnv;
});

test("candidates, one save per job and the list keep progress and compute the score in code", async () => {
  const strong = job("Strong");
  const broken = job("Broken", { description: null });
  const lapsed = job("Lapsed", { deadline: day(-2) });
  const archived = job("Archived", { archived_at: "2026-11-01T00:00:00Z" });
  const sent = job("Sent");
  db().query("INSERT INTO applications (job_id, status, attempt, submission_status) VALUES (?, 'submitted', 1, 'submitted')").run(sent);
  const first = await json<RankingCandidates>("ranking", "candidates");
  expect(first.items.map((item) => item.job_id).sort()).toEqual([strong, broken].sort());
  expect(first).toMatchObject({ eligible: 2, deferred: 0, expired: 1, already_ranked: 0 });
  expect(first.items.find((item) => item.job_id === strong)).toMatchObject({ description: "Strong posting", guard_verdict: "Not checked" });

  const saved = await save(strong, scored(80, 70, 75));
  expect(saved.code).toBe(0);
  expect(JSON.parse(saved.stdout)).toMatchObject({ job_id: strong, status: "scored", overall: 75, verdict: "Strong Fit" });
  // A failure midway keeps what was already stored; the next run resumes with the rest.
  expect(await save(broken, { status: "scored", scores: { technical: 101, experience: 1, career: 1 }, strengths: ["a"], gaps: ["b"] }))
    .toMatchObject({ code: 1, stderr: expect.stringContaining("technical must be an integer score from 0 to 100") });
  expect(await save(strong, { ...scored(1, 1, 1), overall: 99 })).toMatchObject({ code: 1, stderr: expect.stringContaining("overall is computed by Work Tracker") });
  const resumed = await json<RankingCandidates>("ranking", "candidates");
  expect(resumed.items.map((item) => item.job_id)).toEqual([broken]);
  expect(resumed.already_ranked).toBe(1);
  expect(JSON.parse((await save(broken, { status: "unreachable", fetch_error: "404 Not Found" })).stdout)).toMatchObject({ status: "unreachable", fetch_attempts: 1 });

  const list = await json<RankingView[]>("ranking", "list");
  expect(list.map((row) => [row.job_id, row.status])).toEqual([[strong, "scored"], expect.anything(), expect.anything()]);
  expect(list.find((row) => row.job_id === lapsed)).toMatchObject({ status: "expired", expired_reason: "deadline", ranked_at: null });
  expect(list.find((row) => row.job_id === broken)).toMatchObject({ status: "unreachable", last_error: "404 Not Found" });
  expect(list.some((row) => row.job_id === archived)).toBe(false);
  expect(await api<RankingView[]>("rankings")).toEqual(list);
  expect(db().query("SELECT COUNT(*) AS n FROM job_rankings").get()).toEqual({ n: 2 });

  const jobs = await json<Record<string, unknown>[]>("job", "list");
  expect(jobs.find((row) => row.id === strong)).toMatchObject({ ranking_status: "scored", ranking_overall: 75 });
  expect(jobs.find((row) => row.id === lapsed)).toMatchObject({ ranking_status: "expired", ranking_overall: null });
  expect(jobs.find((row) => row.id === archived)).toMatchObject({ ranking_status: null });
});

test("more than the limit defers the rest, and the API preview hides posting text", async () => {
  const ids = Array.from({ length: 12 }, (_, index) => job(`Role ${index}`));
  const preview = await api<RankingCandidates & { items: Record<string, unknown>[] }>("rankings/candidates");
  expect(preview).toMatchObject({ limit: 10, eligible: 12, deferred: 2 });
  expect(preview.items).toHaveLength(10);
  expect(preview.items[0]).toMatchObject({ has_description: true });
  expect(preview.items[0]).not.toHaveProperty("description");
  for (const item of preview.items) await save(item.job_id as number, scored(50, 50, 50));
  const next = await json<RankingCandidates>("ranking", "candidates");
  expect(next).toMatchObject({ eligible: 2, deferred: 0, already_ranked: 10 });
  expect(next.items.map((item) => item.job_id).sort()).toEqual(ids.filter((id) => !preview.items.some((item) => item.job_id === id)).sort());
  expect((await api<RankingCandidates>(`rankings/candidates?job_ids=${ids[0]},${ids[11]}&limit=1`))).toMatchObject({ eligible: 1, deferred: 0 });
  expect(await (await handle(new Request("http://localhost/api/rankings/candidates?limit=0&token=secret"))).json()).toEqual({ error: "limit must be an integer from 1 to 100" });
});

test("an unreachable posting gives up after 3 attempts over 48 hours and --all replaces scores and lists", async () => {
  const id = job("Login wall");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const stored = JSON.parse((await save(id, { status: "unreachable", fetch_error: "LinkedIn login wall" })).stdout) as JobRanking;
    expect(stored).toMatchObject({ status: "unreachable", fetch_attempts: attempt });
  }
  // Three attempts within an hour wait out the 48-hour floor.
  db().query("UPDATE job_rankings SET first_unreachable_at = ? WHERE job_id = ?").run(new Date(Date.now() - 49 * 3_600_000).toISOString(), id);
  expect(JSON.parse((await save(id, { status: "unreachable", fetch_error: "LinkedIn login wall" })).stdout)).toMatchObject({ status: "gave_up", fetch_attempts: 4 });
  expect((await json<RankingCandidates>("ranking", "candidates")).items).toEqual([]);
  const again = await json<RankingCandidates>("ranking", "candidates", "--all");
  expect(again.items.map((item) => item.job_id)).toEqual([id]);
  await save(id, scored(90, 90, 90));
  await save(id, { status: "scored", scores: { technical: 40, experience: 40, career: 40 }, strengths: ["Only one"], gaps: ["Only gap"] });
  expect(await json<RankingView[]>("ranking", "list")).toEqual([expect.objectContaining({ job_id: id, overall: 40, verdict: "Weak Fit", strengths: ["Only one"], gaps: ["Only gap"], fetch_attempts: 0 })]);
});
