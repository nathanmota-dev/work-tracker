import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "work-tracker-search-save-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let handle: ReturnType<typeof import("../../server/index.ts").createRequestHandler>;
const acp = { run: vi.fn(async () => {}), cancel: vi.fn() };
const broadcast = vi.fn();
const call = async (body: unknown, method = "POST", token = "secret") => {
  const response = await handle(new Request(`http://localhost/api/jobs/save-search?token=${token}`, {
    method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }));
  return { status: response.status, body: await response.json().catch(() => null) as any };
};
beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  const { createRequestHandler } = await import("../../server/index.ts");
  handle = createRequestHandler({ token: "secret", acp, broadcast });
});
afterAll(() => {
  closeDb(); rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME;
  else process.env.WORK_TRACKER_HOME = previousHome;
});

test("mixed search batches preserve saved content and artifacts, isolate rollback and deduplicate retries", async () => {
  const prior = await handle(new Request("http://localhost/api/jobs/create?token=secret", { method: "POST", body: JSON.stringify({ title: "Original role", company_name: "Original company", link: "https://linkedin.com/jobs/view/42", description: "Original description", status: "assessed", fit: "strong" }) }));
  const original = (await prior.json() as any).job;
  db().query("UPDATE jobs SET archived_at = 'before' WHERE id = ?").run(original.id);
  db().query("INSERT INTO applications (job_id, role_title, resume_path) VALUES (?, 'Original role', '/synthetic.pdf')").run(original.id);
  db().query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, created_at, updated_at) VALUES ('prior', ?, 1, 'completed', 'review', 'fake', 'then', 'then')").run(original.id);
  db().query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES ('pdf', 'prior', 'tailored', '/synthetic.pdf', 1, 'Original PDF', '[]')").run();
  const before = ["jobs", "applications", "application_runs", "pdf_artifacts"].map(table => db().query(`SELECT * FROM ${table}`).all());
  db().exec("CREATE TRIGGER fail_search AFTER INSERT ON jobs WHEN NEW.title = 'Write failure' BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
  const items = [
    { key: "new", result: { job_title: "New role", company: { name: "Synthetic" }, job_id: 43, location: "Remote" } },
    { key: "duplicate", result: { title: "Changed", company: "Changed", link: "https://www.linkedin.com/jobs/view/42/?trk=search" } },
    { key: "invalid", result: { title: "Missing company", job_id: 44 } },
    { key: "disk", result: { title: "Write failure", company: "Synthetic", job_id: 45 } },
    { key: "after", result: { title: "Later role", company: "Synthetic", job_id: 46 } },
    { key: "text", result: "Text-only role at Synthetic https://example.test/47" },
  ];
  broadcast.mockClear();
  const first = await call({ items });
  expect(first.status).toBe(200);
  expect(first.body.results.map((r: any) => [r.key, r.status])).toEqual([
    ["new", "saved"], ["duplicate", "existing"], ["invalid", "failed"], ["disk", "failed"], ["after", "saved"], ["text", "failed"],
  ]);
  expect(first.body.results[1].job).toMatchObject({ ...original, archived_at: "before" });
  expect(first.body.results[3].error).not.toContain("disk failure");
  expect(broadcast).toHaveBeenCalledExactlyOnceWith({ type: "changed", table: "jobs" });
  const second = await call({ items });
  expect(second.body.results.map((r: any) => r.status)).toEqual(["existing", "existing", "failed", "failed", "existing", "failed"]);
  expect(second.body.results[0].job.id).toBe(first.body.results[0].job.id);
  expect(db().query("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 3 });
  expect(db().query("SELECT * FROM jobs WHERE id = ?").get(original.id)).toEqual(before[0]![0]);
  expect(["applications", "application_runs", "pdf_artifacts"].map(table => db().query(`SELECT * FROM ${table}`).all())).toEqual(before.slice(1));
  expect(acp.run).not.toHaveBeenCalled();
  closeDb();
  expect(db().query("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 3 });
});
test("batch endpoint enforces authentication, methods and batch validation without writes", async () => {
  expect((await call({}, "POST", "invalid")).status).toBe(403);
  expect((await call({}, "GET")).status).toBe(405);
  broadcast.mockClear();
  for (const body of [null, {}, { items: [] }, { items: [{ key: "a" }, { key: "a" }] }])
    expect((await call(body)).status).toBe(400);
  expect(broadcast).not.toHaveBeenCalled();
  expect(acp.run).not.toHaveBeenCalled();
});
