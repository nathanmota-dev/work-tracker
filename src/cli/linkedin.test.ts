import { beforeEach, expect, test, vi } from "vitest";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { sweepLinkedinBrowsers, linkedinCmd } from "./linkedin.ts";
import { cliSpies } from "../test/doubles.ts";
vi.mock("../paths.ts", () => ({
  paths: { linkedinProfile: "/private/linkedin/profile" },
}));
beforeEach(() => {
  cliSpies();
  vi.spyOn(process, "kill").mockReturnValue(true);
  vi.mocked(rmSync).mockReturnValue(undefined);
});
test("reset kills only Chrome processes with the exact private profile and clears its three locks", async () => {
  vi.mocked(readdirSync).mockReturnValue([
    "self",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
  ] as unknown as ReturnType<typeof readdirSync>);
  const commands: Record<string, string[]> = {
    "1": ["/usr/bin/chrome", "--user-data-dir=/private/linkedin/profile"],
    "2": ["chromium", "--user-data-dir", "/private/linkedin/profile"],
    "3": ["chrome", "--user-data-dir=/private/linkedin/profile-other"],
    "4": ["node", "--user-data-dir=/private/linkedin/profile"],
    "5": ["chrome", "--user-data-dir=/shared"],
  };
  vi.mocked(readFileSync).mockImplementation((path) => {
    const id = String(path).split("/")[2];
    if (!commands[id]) throw new Error("process gone");
    return commands[id].join("\0");
  });
  expect(await sweepLinkedinBrowsers()).toEqual({ killed: 2, locksCleared: 3 });
  expect(vi.mocked(process.kill).mock.calls).toEqual([
    [1, "SIGKILL"],
    [2, "SIGKILL"],
  ]);
  expect(vi.mocked(rmSync).mock.calls.map(([path]) => path)).toEqual([
    "/private/linkedin/profile/SingletonLock",
    "/private/linkedin/profile/SingletonCookie",
    "/private/linkedin/profile/SingletonSocket",
  ]);
});
test("already exited processes and absent locks are tolerated; unknown subcommand rejects", async () => {
  vi.mocked(readdirSync).mockReturnValue(["1"] as unknown as ReturnType<
    typeof readdirSync
  >);
  vi.mocked(readFileSync).mockReturnValue(
    "chrome\0--user-data-dir=/private/linkedin/profile\0",
  );
  vi.mocked(process.kill).mockImplementation(() => {
    throw new Error("ESRCH");
  });
  vi.mocked(rmSync).mockImplementation(() => {
    throw new Error("ENOENT");
  });
  await linkedinCmd("reset", {});
  expect(console.log).toHaveBeenCalledWith({ killed: 0, locksCleared: 0 });
  await expect(linkedinCmd("missing", {})).rejects.toThrow("usage:");
});
