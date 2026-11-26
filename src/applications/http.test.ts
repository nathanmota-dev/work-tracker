import { beforeEach, expect, test, vi } from "vitest";
import {
  ApplicationBoardError,
  executeApplicationAction,
  listApplicationBoard,
} from "./store.ts";
import { handleApplicationBoard } from "./http.ts";
vi.mock("./store.ts", async (original) => ({
  ...(await original<typeof import("./store.ts")>()),
  executeApplicationAction: vi.fn(),
  listApplicationBoard: vi.fn(),
}));
const broadcast = vi.fn();
const call = (action = "", method = "POST", body = "{}", query = "") =>
  handleApplicationBoard(
    `/api/application-board${action ? `/${action}` : ""}`,
    new Request(`http://local/api/application-board${action ? `/${action}` : ""}${query}`, {
      method,
      ...(method === "POST" ? { body } : {}),
    }),
    broadcast,
  );
beforeEach(() => {
  vi.mocked(executeApplicationAction)
    .mockReset()
    .mockReturnValue({ value: [], changed: [] });
  broadcast.mockClear();
});
test("lists the board and rejects invalid routes, methods and JSON", async () => {
  vi.mocked(listApplicationBoard).mockReturnValue({
    stages: [],
    applications: [],
  });
  expect(await (await call("", "GET")).json()).toEqual({
    stages: [],
    applications: [],
  });
  expect((await call()).status).toBe(405);
  expect((await call("move", "GET")).status).toBe(405);
  expect((await call("missing")).status).toBe(404);
  expect((await call("create", "POST", "{")).status).toBe(400);
  expect(executeApplicationAction).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});
test.each([
  "create",
  "update",
  "portal-link",
  "move",
  "archive",
  "reopen",
  "details",
  "stages/save",
  "stages/reorder",
  "stages/set-archived",
  "quiet/resolve",
])("dispatches %s and only broadcasts returned changes", async (action) => {
  vi.mocked(executeApplicationAction).mockReturnValue({
    value: [],
    changed: ["applications", "application_events"],
  });
  const response = await call(action, "POST", '{"id":2}');
  expect(response.status).toBe(action === "create" ? 201 : 200);
  expect(executeApplicationAction).toHaveBeenCalledWith(action, { id: 2 });
  expect(broadcast.mock.calls).toEqual([
    [{ type: "changed", table: "applications" }],
    [{ type: "changed", table: "application_events" }],
  ]);
});
test("scans quiet applications with GET and the query string, without notifying", async () => {
  vi.mocked(executeApplicationAction).mockReturnValue({
    value: { days: 90, items: [], skipped: [] },
    changed: [],
  });
  const response = await call("quiet", "GET", undefined, "?days=90&token=secret");
  expect(await response.json()).toEqual({ days: 90, items: [], skipped: [] });
  expect(executeApplicationAction).toHaveBeenLastCalledWith("quiet", { days: "90" });
  await call("quiet", "GET");
  expect(executeApplicationAction).toHaveBeenLastCalledWith("quiet", {});
  expect((await call("quiet", "POST")).status).toBe(405);
  expect((await call("quiet/resolve", "GET")).status).toBe(405);
  vi.mocked(executeApplicationAction).mockImplementation(() => {
    throw new ApplicationBoardError("Days without activity must be a whole number from 7 to 3650.");
  });
  const invalid = await call("quiet", "GET", undefined, "?days=3");
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ error: "Days without activity must be a whole number from 7 to 3650." });
  expect(broadcast).not.toHaveBeenCalled();
});
test("does not notify for no-op or failures and preserves domain status", async () => {
  await call("move");
  expect(broadcast).not.toHaveBeenCalled();
  vi.mocked(executeApplicationAction).mockImplementation(() => {
    throw new ApplicationBoardError("conflict", 409);
  });
  const response = await call("move");
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "conflict" });
  vi.mocked(executeApplicationAction).mockImplementation(() => {
    throw new Error("unexpected");
  });
  await expect(call("move")).rejects.toThrow("unexpected");
  expect(broadcast).not.toHaveBeenCalled();
});
