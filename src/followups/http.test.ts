import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { followUpDays, followupCandidates } from "./candidates.ts";
import { handleFollowups } from "./http.ts";
import { discardFollowup, listFollowups, markFollowupSent } from "./store.ts";
import { FollowupError } from "./types.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(() => "db"), now: () => "now" }));
vi.mock("./candidates.ts", async (original) => ({ ...(await original<typeof import("./candidates.ts")>()), followupCandidates: vi.fn() }));
vi.mock("./store.ts", () => ({ listFollowups: vi.fn(), markFollowupSent: vi.fn(), discardFollowup: vi.fn() }));

const broadcast = vi.fn();
beforeEach(() => {
  vi.mocked(db).mockReturnValue("db" as never);
  vi.mocked(listFollowups).mockReturnValue([]);
  vi.mocked(followupCandidates).mockReturnValue({ days: 10, follow_ups: [], thank_yous: [] });
});
const call = (path: string, method = "GET", body?: unknown) =>
  handleFollowups(path.split("?")[0]!, new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }), broadcast);

test("lists every draft or the drafts of one application", async () => {
  expect(await (await call("/api/followups")).json()).toEqual([]);
  expect(listFollowups).toHaveBeenLastCalledWith();
  expect((await call("/api/followups?application_id=12&token=x")).status).toBe(200);
  expect(listFollowups).toHaveBeenLastCalledWith(12);
});

test.each(["0", "abc", "-1", "1.5", ""])("rejects the application id %j", async (id) => {
  const response = await call(`/api/followups?application_id=${id}`);
  expect(response.status).toBe(400);
  expect(listFollowups).not.toHaveBeenCalled();
});

test("scans candidates with the default or a valid threshold and rejects bad ones", async () => {
  expect(await (await call("/api/followups/candidates")).json()).toEqual({ days: 10, follow_ups: [], thank_yous: [] });
  expect(followupCandidates).toHaveBeenLastCalledWith("db", { days: 10 });
  await call("/api/followups/candidates?days=14");
  expect(followupCandidates).toHaveBeenLastCalledWith("db", { days: 14 });
  const invalid = await call("/api/followups/candidates?days=3");
  expect(invalid.status).toBe(400);
  expect(((await invalid.json()) as { error: string }).error).toContain("from 7");
  expect([followUpDays(undefined), followUpDays(""), followUpDays("30")]).toEqual([10, 10, 30]);
});

test("marks as sent or discards, broadcasting only real changes", async () => {
  vi.mocked(markFollowupSent).mockReturnValueOnce({ changed: true, draft: { id: 3, status: "sent" } as never });
  expect(await (await call("/api/followups/sent", "POST", { id: 3 })).json()).toEqual({ id: 3, status: "sent" });
  expect(markFollowupSent).toHaveBeenCalledWith(3);
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "followup_drafts" });
  broadcast.mockClear();
  vi.mocked(discardFollowup).mockReturnValueOnce({ changed: false, draft: { id: 3, status: "discarded" } as never });
  expect((await call("/api/followups/discard", "POST", { id: 3 })).status).toBe(200);
  expect(broadcast).not.toHaveBeenCalled();
});

test("answers store errors with their status and rethrows unexpected ones", async () => {
  vi.mocked(markFollowupSent).mockImplementationOnce(() => { throw new FollowupError("capped", 409); });
  const capped = await call("/api/followups/sent", "POST", { id: 3 });
  expect([capped.status, ((await capped.json()) as { error: string }).error]).toEqual([409, "capped"]);
  expect((await call("/api/followups/sent", "POST", "not json")).status).toBe(400);
  vi.mocked(discardFollowup).mockImplementationOnce(() => { throw new Error("disk"); });
  await expect(call("/api/followups/discard", "POST", { id: 1 })).rejects.toThrow("disk");
});

test.each([
  ["/api/followups", "POST", 405],
  ["/api/followups/candidates", "POST", 405],
  ["/api/followups/sent", "PUT", 405],
  ["/api/followups/sent", "GET", 404],
  ["/api/followups/other", "POST", 404],
])("%s with %s answers %i", async (path, method, status) => {
  expect((await call(path, method, method === "GET" ? undefined : {})).status).toBe(status);
});
