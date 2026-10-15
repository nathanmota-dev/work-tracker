import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { databaseDouble } from "../test/doubles.ts";
import { handleJobAction } from "./http.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "now" }));
let d: ReturnType<typeof databaseDouble>;
const broadcast = vi.fn();
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  broadcast.mockClear();
});
const call = (action: string, body: unknown = { id: 1 }, method = "POST") =>
  handleJobAction(
    `/api/jobs/${action}`,
    new Request("http://local", {
      method,
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }),
    broadcast,
  );
test.each([
  null,
  [],
  {},
  { id: "1" },
  { id: 0 },
  { id: -1 },
  { id: 1.5 },
  { id: Number.MAX_SAFE_INTEGER + 1 },
])("rejects invalid body %j without database access", async (body) => {
  expect((await call("archive", body)).status).toBe(400);
  expect(db).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});
test("rejects malformed JSON, methods, unknown actions and absent jobs", async () => {
  expect(
    (
      await handleJobAction(
        "/api/jobs/archive",
        new Request("http://local", { method: "POST", body: "{" }),
        broadcast,
      )
    ).status,
  ).toBe(400);
  expect((await call("archive", undefined, "GET")).status).toBe(405);
  expect((await call("missing")).status).toBe(404);
  expect((await call("archive")).status).toBe(404);
  expect(broadcast).not.toHaveBeenCalled();
});
test.each([
  ["archive", null, "now"],
  ["archive", "original", "original"],
  ["restore", "original", null],
])("%s preserves lifecycle dates", async (action, archived, expected) => {
  d.statement.get.mockReturnValue({ id: 1, archived_at: archived });
  const response = await call(String(action));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(d.statement.run).toHaveBeenCalledWith(expected, 1);
  expect(broadcast).toHaveBeenCalledExactlyOnceWith({
    type: "changed",
    table: "jobs",
  });
});
test("deletes only unlinked jobs and checks all three kinds of history", async () => {
  d.statement.get
    .mockReturnValueOnce({ id: 1 })
    .mockReturnValueOnce({ linked: 1 });
  expect((await call("delete")).status).toBe(409);
  expect(d.statement.run).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
  expect(d.query.mock.calls.map(([sql]) => sql).join(" ")).toContain(
    "application_runs",
  );
  expect(d.statement.get).toHaveBeenLastCalledWith(1, 1, 1);
  d.statement.get.mockReturnValueOnce({ id: 1 }).mockReturnValueOnce(undefined);
  expect((await call("delete")).status).toBe(200);
  expect(d.statement.run).toHaveBeenCalledWith(1);
});
