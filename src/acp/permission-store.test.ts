import { beforeEach, expect, test, vi } from "vitest";
import { permissionStore } from "./permission-store.ts";
import { db } from "../db/index.ts";
import { databaseDouble } from "../test/doubles.ts";
import type { PermissionRequest } from "./permission-types.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
const request = { id: "permission", title: "get_jobs", status: "pending", options: [] } as unknown as PermissionRequest;
beforeEach(() => { d = databaseDouble(); vi.mocked(db).mockReturnValue(d.asDatabase); });
test("loads rules, replaces exact rules and revokes without affecting other tools", () => {
  expect(permissionStore.rules()).toEqual([]);
  d.statement.get.mockReturnValue({ value: JSON.stringify([{ provider: "opencode", tool: "get_jobs" }, { provider: "opencode", tool: "read_file" }]) });
  permissionStore.setRule({ provider: "opencode", tool: "get_jobs" }, false);
  expect(d.statement.run).toHaveBeenLastCalledWith("agent_tool_allowlist", JSON.stringify([{ provider: "opencode", tool: "read_file" }]));
  permissionStore.setRule({ provider: "opencode", tool: "get_jobs" }, true);
  expect(d.statement.run).toHaveBeenLastCalledWith("agent_tool_allowlist", JSON.stringify([{ provider: "opencode", tool: "read_file" }, { provider: "opencode", tool: "get_jobs" }]));
});
test("creates a pending record and updates its decision and allowlist in a transaction", () => {
  permissionStore.save(request);
  expect(d.statement.run).toHaveBeenLastCalledWith("get_jobs: pending", JSON.stringify(request));
  d.statement.get.mockImplementation((...args) => args[0] === "permission" ? { id: 7 } : undefined);
  const decided = { ...request, status: "selected" as const, optionId: "yes", reason: "User decision" };
  permissionStore.save(decided, { provider: "opencode", tool: "get_jobs" });
  expect(d.statement.run).toHaveBeenCalledWith("get_jobs: selected (yes) · User decision", JSON.stringify(decided), 7);
  expect(d.transaction).toHaveBeenCalledTimes(2);
});
test("history parses records and recovery cancels pending decisions after a restart", () => {
  d.statement.all.mockReturnValue([{ payload_json: JSON.stringify(request) }]);
  expect(permissionStore.history()).toEqual([request]);
  permissionStore.recover();
  expect(d.statement.run).toHaveBeenCalledWith("get_jobs: cancelled · App restarted", expect.stringContaining('"status":"cancelled"'));
});
