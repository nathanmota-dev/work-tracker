import { beforeEach, expect, test, vi } from "vitest";
import { saveSearchResults } from "./search-save.ts";
import { db } from "../db/index.ts";
import { saveJob, JobError } from "./store.ts";
import { databaseDouble } from "../test/doubles.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
vi.mock("./store.ts", async original => ({ ...await original<typeof import("./store.ts")>(), saveJob: vi.fn() }));
const broadcast = vi.fn();
const result = { title: "Role", company: "Corp", id: "42" };
beforeEach(() => {
  vi.mocked(db).mockReturnValue(databaseDouble().asDatabase);
  vi.mocked(saveJob).mockReset();
  broadcast.mockClear();
});
test("rejects malformed batches before touching persistence", () => {
  for (const body of [null, [], {}, { items: [] }, { items: Array(501).fill({ key: "a" }) }, { items: [null] }, { items: [{ key: 2 }] }, { items: [{ key: " " }] }, { items: [{ key: "a" }, { key: "a" }] }])
    expect(saveSearchResults(body, broadcast).status).toBe(400);
  expect(saveJob).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});
test("returns each outcome, isolates errors and notifies only after successful writes", async () => {
  const saved = { job: { id: 7 } as any, created: true, existing: false, missing: [] };
  vi.mocked(saveJob).mockReturnValueOnce(saved).mockReturnValueOnce({ ...saved, existing: true })
    .mockImplementationOnce(() => { throw new JobError("Identity conflict"); })
    .mockImplementationOnce(() => { throw new Error("private database path"); });
  const response = saveSearchResults({ items: [0, 1, 2, 3].map(key => ({ key: String(key), result })) }, broadcast);
  expect(await response.json()).toEqual({ results: [
    { key: "0", status: "saved", job: { id: 7 } }, { key: "1", status: "existing", job: { id: 7 } },
    { key: "2", status: "failed", error: "Identity conflict" }, { key: "3", status: "failed", error: "Could not save this job. Try again." },
  ] });
  expect(broadcast).toHaveBeenCalledOnce();
  broadcast.mockClear();
  const failed = saveSearchResults({ items: [{ key: "text", result: "Role at Corp" }] }, broadcast);
  expect(await failed.json()).toMatchObject({ results: [{ status: "failed", error: "A structured job result is required." }] });
  expect(broadcast).not.toHaveBeenCalled();
});
