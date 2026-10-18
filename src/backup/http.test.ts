import { beforeEach, expect, test, vi } from "vitest";
import { handleWorkspaceBackup } from "./http.ts";
import { createBackup } from "./create.ts";
import { inspectBackup } from "./inspect.ts";
import { restoreBackup } from "./restore.ts";
import { BackupError } from "./format.ts";
vi.mock("./create.ts", () => ({ createBackup: vi.fn() }));
vi.mock("./inspect.ts", () => ({ inspectBackup: vi.fn() }));
vi.mock("./restore.ts", () => ({ restoreBackup: vi.fn() }));
const broadcast = vi.fn();
let busy = false;
const call = async (path: string, body: string | null = "{}", method = "POST") => {
  const response = await handleWorkspaceBackup(`/api/workspace-backup/${path}`, new Request("http://local", { method, ...(body === null ? {} : { body }) }), { busy: () => busy, broadcast });
  return { status: response.status, body: await response.json() };
};
beforeEach(() => {
  busy = false;
  vi.mocked(createBackup).mockReturnValue({ path: "/b/new" } as never);
  vi.mocked(inspectBackup).mockReturnValue({ summary: { path: "/b/old" } } as never);
  vi.mocked(restoreBackup).mockReturnValue({ previous: "/home/backups/pre" } as never);
});

test("creates, inspects and restores, notifying dashboards only after a restore", async () => {
  expect(await call("create", '{"destination":"/b"}')).toEqual({ status: 200, body: { path: "/b/new" } });
  expect(createBackup).toHaveBeenCalledWith("/b");
  expect(await call("inspect", '{"path":"/b/old"}')).toEqual({ status: 200, body: { path: "/b/old" } });
  expect(inspectBackup).toHaveBeenCalledWith("/b/old");
  expect(broadcast).not.toHaveBeenCalled();
  expect(await call("restore", '{"path":"/b/old","fingerprint":"f"}')).toEqual({ status: 200, body: { previous: "/home/backups/pre" } });
  expect(restoreBackup).toHaveBeenCalledWith("/b/old", "f");
  expect(broadcast).toHaveBeenCalledWith({ type: "changed" });
});

test("refuses backup and restore while an execution is active", async () => {
  busy = true;
  for (const path of ["create", "restore"]) expect((await call(path)).status).toBe(409);
  expect(createBackup).not.toHaveBeenCalled();
  expect(restoreBackup).not.toHaveBeenCalled();
  expect((await call("inspect")).status).toBe(200);
});

test.each([
  ["GET requests", "create", null, "GET", 405],
  ["invalid JSON", "create", "{", "POST", 400],
  ["arrays", "inspect", "[]", "POST", 400],
  ["unknown actions", "delete", "{}", "POST", 404],
] as const)("rejects %s", async (_name, path, body, method, status) => {
  expect((await call(path, body, method)).status).toBe(status);
});

test("maps backup errors to their status and unexpected errors to 500", async () => {
  vi.mocked(restoreBackup).mockImplementationOnce(() => { throw new BackupError("changed", 409); });
  expect(await call("restore")).toEqual({ status: 409, body: { error: "changed" } });
  vi.mocked(inspectBackup).mockImplementationOnce(() => { throw new Error("EACCES"); });
  expect(await call("inspect")).toEqual({ status: 500, body: { error: "EACCES" } });
  expect(broadcast).not.toHaveBeenCalled();
});
