import { beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
vi.mock("node:os", () => ({ homedir: () => "/candidate" }));
beforeEach(() => {
  vi.resetModules();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(mkdirSync).mockReturnValue(undefined);
  vi.mocked(writeFileSync).mockReturnValue(undefined);
});

test("default home and explicit relative override resolve independently of the caller's home", async () => {
  vi.stubEnv("WORK_TRACKER_HOME", undefined);
  expect((await import("./paths.ts")).paths).toMatchObject({
    home: "/candidate/.work-tracker",
    db: "/candidate/.work-tracker/work-tracker.db",
  });
  vi.resetModules();
  vi.stubEnv("WORK_TRACKER_HOME", "fixture home");
  const { paths } = await import("./paths.ts");
  expect(paths.home).toBe(`${process.cwd()}/fixture home`);
  expect(paths.linkedinProfile).toBe(`${paths.home}/browsers/linkedin/profile`);
  expect(paths.chromeProfile).toBe(`${paths.home}/browsers/chrome/profile`);
});
test("home creation uses private modes, skips existing files, and tolerates config creation races", async () => {
  const { ensureHome, paths } = await import("./paths.ts");
  ensureHome();
  expect(mkdirSync).toHaveBeenCalledTimes(4);
  expect(mkdirSync).toHaveBeenCalledWith(paths.home, {
    recursive: true,
    mode: 0o700,
  });
  expect(writeFileSync).toHaveBeenCalledWith(paths.config, "{}\n", {
    flag: "wx",
    mode: 0o600,
  });
  vi.mocked(existsSync).mockReturnValue(true);
  vi.clearAllMocks();
  ensureHome();
  expect(writeFileSync).not.toHaveBeenCalled();
  expect(mkdirSync).not.toHaveBeenCalled();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(writeFileSync).mockImplementation(() => {
    throw Object.assign(new Error("race"), { code: "EEXIST" });
  });
  expect(ensureHome).not.toThrow();
  vi.mocked(writeFileSync).mockImplementation(() => {
    throw new Error("denied");
  });
  expect(ensureHome).toThrow("denied");
});
test("missing, malformed or unreadable configuration falls back to an empty object", async () => {
  const { loadConfig } = await import("./paths.ts");
  expect(loadConfig()).toEqual({});
  expect(readFileSync).not.toHaveBeenCalled();
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue("{");
  expect(loadConfig()).toEqual({});
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("denied");
  });
  expect(loadConfig()).toEqual({});
});
test("outreach merges nested policies without modifying defaults; saved configuration is private", async () => {
  const { loadOutreachConfig, DEFAULT_OUTREACH_CONFIG, saveConfig, paths } =
    await import("./paths.ts");
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({
      outreach: {
        followupAfterDays: 2,
        inmail: { reserveFloor: 3 },
        invites: { weeklyLimit: 20 },
      },
    }),
  );
  expect(loadOutreachConfig()).toMatchObject({
    followupAfterDays: 2,
    inviteWithdrawDays: 7,
    inmail: { reserveFloor: 3, monthlyAllotment: 5 },
    invites: { weeklyLimit: 20 },
  });
  expect(DEFAULT_OUTREACH_CONFIG.inmail.reserveFloor).toBe(1);
  vi.mocked(readFileSync).mockReturnValue("{}");
  expect(loadOutreachConfig()).toEqual(DEFAULT_OUTREACH_CONFIG);
  saveConfig({ username: "fixture" });
  expect(writeFileSync).toHaveBeenLastCalledWith(
    paths.config,
    '{\n  "username": "fixture"\n}',
    { mode: 0o600 },
  );
});
