import { beforeEach, expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { notifyChange } from "./notify.ts";
import { paths } from "../paths.ts";
beforeEach(() => {
  vi.mocked(existsSync).mockReturnValue(false);
});
test("missing lock does not contact backend", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await notifyChange("jobs");
  expect(existsSync).toHaveBeenCalledWith(paths.serverLock);
  expect(fetch).not.toHaveBeenCalled();
});
test("invalid lock and inaccessible files are tolerated", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue("{");
  await expect(notifyChange("jobs")).resolves.toBeUndefined();
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("gone");
  });
  await notifyChange("jobs");
  expect(fetch).not.toHaveBeenCalled();
});
test("authenticates the change hook with the lock token and tolerates network failure", async () => {
  const fetch = vi.fn().mockResolvedValue({ status: 403 });
  vi.stubGlobal("fetch", fetch);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(
    '{"port":1234,"token":"fixture-token"}',
  );
  await notifyChange("jobs");
  expect(fetch).toHaveBeenCalledWith(
    "http://127.0.0.1:1234/_internal/changed",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-work-tracker-token": "fixture-token",
      },
      body: '{"table":"jobs"}',
      signal: expect.any(AbortSignal),
    },
  );
  fetch.mockRejectedValue(new Error("offline"));
  await expect(notifyChange("jobs")).resolves.toBeUndefined();
});
