import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { db } from "../db/index.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import { handleInterviews } from "./http.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn() }));

let d: Database;
const broadcast = vi.fn();
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  broadcast.mockClear();
});
afterEach(() => d.close());

const call = (action: string, body: unknown, method = "POST") =>
  handleInterviews(`/api/interviews/${action}`, new Request("http://local", {
    method, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  }), broadcast);
const rows = () => d.query("SELECT id, company, scheduled_at, stage, status, notes FROM interviews ORDER BY id").all();

test("creates, updates and deletes an interview and announces each change", async () => {
  const created = await call("create", { company: " Acme ", scheduled_at: "2026-10-20T15:30:00.000Z", stage: "technical", notes: "  " });
  expect(created.status).toBe(201);
  const { id } = await created.json() as { id: number };
  expect(rows()).toEqual([{ id, company: "Acme", scheduled_at: "2026-10-20T15:30:00.000Z", stage: "technical", status: "scheduled", notes: null }]);
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "interviews" });

  const updated = await call("update", { id, company: "Acme", scheduled_at: null, stage: "", status: "done", notes: "Went well" });
  expect(updated.status).toBe(200);
  expect(rows()).toEqual([{ id, company: "Acme", scheduled_at: null, stage: null, status: "done", notes: "Went well" }]);

  expect((await call("delete", { id })).status).toBe(200);
  expect(rows()).toEqual([]);
  expect(broadcast).toHaveBeenCalledTimes(3);
});

test.each([
  [{ company: " " }, "Company is required."],
  [{ company: "Acme", status: "lost" }, "Status must be one of scheduled, done, closed, cancelled."],
  [{ company: "Acme", scheduled_at: "not a date" }, "Schedule must be a valid date."],
])("rejects an invalid interview %j", async (body, error) => {
  const response = await call("create", body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error });
  expect(rows()).toEqual([]);
  expect(broadcast).not.toHaveBeenCalled();
});

test("rejects unknown actions, other methods, malformed bodies, missing ids and absent interviews", async () => {
  expect((await call("archive", {})).status).toBe(404);
  expect((await call("create", null, "GET")).status).toBe(405);
  expect((await call("create", "{")).status).toBe(400);
  for (const id of [undefined, 0, -1, 1.5, "1"]) expect((await call("update", { id, company: "Acme" })).status).toBe(400);
  const absent = await call("delete", { id: 99 });
  expect(absent.status).toBe(404);
  expect(await absent.json()).toEqual({ error: "Interview not found." });
  expect(broadcast).not.toHaveBeenCalled();
});
