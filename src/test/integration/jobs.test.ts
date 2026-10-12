import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/sqlite.ts";
import { SCHEMA_SQL } from "../../db/schema.ts";

const home = mkdtempSync(join(tmpdir(), "work-tracker-jobs-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let jobCmd: typeof import("../../cli/records.ts").jobCmd;
let handle: ReturnType<typeof import("../../server/index.ts").createRequestHandler>;
const broadcast = vi.fn();
const request = (action: string, body?: unknown, method = "POST", token = "secret") =>
  handle(new Request(`http://localhost/api/jobs/${action}?token=${token}`, {
    method,
    ...(method === "GET" ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  }));
const create = (linkedinId: string) => db().query(
  "INSERT INTO jobs (linkedin_job_id, title, status) VALUES (?, 'Engineer', 'saved') RETURNING id",
).get(linkedinId) as { id: number };
const find = (id: number) => db().query("SELECT * FROM jobs WHERE id = ?").get(id);

beforeAll(async () => {
  const legacy = new Database(join(home, "work-tracker.db"));
  legacy.exec(SCHEMA_SQL);
  legacy.exec("INSERT INTO jobs (linkedin_job_id, title, status) VALUES ('legacy', 'Existing role', 'applied')");
  legacy.close();
  ({ db, closeDb } = await import("../../db/index.ts"));
  ({ jobCmd } = await import("../../cli/records.ts"));
  const { createRequestHandler } = await import("../../server/index.ts");
  handle = createRequestHandler({ token: "secret", acp: { run: async () => {}, cancel: () => {} }, broadcast });
});
beforeEach(() => broadcast.mockClear());
afterAll(() => {
  closeDb();
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME;
  else process.env.WORK_TRACKER_HOME = previousHome;
});

test("additive job migration preserves existing records and survives reopening", () => {
  expect(find(1)).toMatchObject({ title: "Existing role", status: "applied", archived_at: null });
  closeDb();
  expect(find(1)).toMatchObject({ title: "Existing role", archived_at: null });
});

test("archive persists across restart and rediscovery; restoration retains the original status", async () => {
  const job = create("rediscovered");
  expect((await request("archive", job)).status).toBe(200);
  const archived = find(job.id) as { archived_at: string };
  expect(archived.archived_at).toBeTruthy();
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "jobs" });
  await request("archive", job);
  closeDb();
  expect(find(job.id)).toMatchObject({ archived_at: archived.archived_at, status: "saved" });
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await jobCmd("save", { "linkedin-id": "rediscovered", status: "new", fit: "strong" });
    expect(output).toHaveBeenCalledWith(`job #${job.id} remains archived`);
    expect(find(job.id)).toMatchObject({ archived_at: archived.archived_at, status: "saved", fit: "strong" });
    await jobCmd("list", {});
    const listed = JSON.parse(output.mock.calls.at(-1)![0] as string);
    expect(listed).toContainEqual(expect.objectContaining({ id: job.id, archived_at: archived.archived_at }));
  } finally { output.mockRestore(); }
  const { queries } = await import("../../server/queries.ts");
  expect(queries.jobs()).toContainEqual(expect.objectContaining({ id: job.id, archived_at: archived.archived_at }));
  expect((await request("restore", job)).status).toBe(200);
  expect(find(job.id)).toMatchObject({ archived_at: null, status: "saved" });
});

test.each(["applications", "interviews"])("delete protects linked %s and archive keeps the link", async (table) => {
  const job = create(`linked-${table}`);
  if (table === "interviews")
    db().query("INSERT INTO interviews (job_id, company) VALUES (?, 'Acme')").run(job.id);
  else
    db().query("INSERT INTO applications (job_id) VALUES (?)").run(job.id);
  const response = await request("delete", job);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("Archive") });
  expect(find(job.id)).toBeTruthy();
  expect(broadcast).not.toHaveBeenCalled();
  expect((await request("archive", job)).status).toBe(200);
  expect(db().query(`SELECT job_id FROM ${table} WHERE job_id = ?`).get(job.id)).toEqual({ job_id: job.id });
});

test("delete removes an unlinked role, including an archived role, and notifies clients", async () => {
  const job = create("false-positive");
  await request("archive", job);
  broadcast.mockClear();
  expect((await request("delete", job)).status).toBe(200);
  expect(find(job.id)).toBeUndefined();
  expect(broadcast).toHaveBeenCalledExactlyOnceWith({ type: "changed", table: "jobs" });
  expect((await request("delete", job)).status).toBe(404);
});

test("invalid, unauthenticated, unknown and wrong-method actions never mutate or notify", async () => {
  const job = create("validation");
  expect((await request("archive", job, "POST", "bad")).status).toBe(403);
  expect((await request("archive", undefined, "GET")).status).toBe(405);
  expect((await request("unknown", job)).status).toBe(404);
  for (const body of [null, [], {}, { id: "1" }, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }])
    expect((await request("archive", body)).status).toBe(400);
  expect((await handle(new Request("http://localhost/api/jobs/archive?token=secret", { method: "POST", body: "invalid json" }))).status).toBe(400);
  expect((await request("restore", { id: 999999 })).status).toBe(404);
  expect(find(job.id)).toMatchObject({ archived_at: null });
  expect(broadcast).not.toHaveBeenCalled();
});
