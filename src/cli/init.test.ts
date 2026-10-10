import { beforeEach, expect, test, vi } from "vitest";
import { initCmd } from "./init.ts";
import { ensureHome, loadConfig, saveConfig } from "../paths.ts";
import { db } from "../db/index.ts";
import { cliSpies } from "../test/doubles.ts";
vi.mock("../paths.ts", () => ({
  ensureHome: vi.fn(),
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  paths: { home: "/private", db: "/private/db", config: "/private/config" },
}));
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: vi.fn() }));
beforeEach(() => {
  cliSpies();
  vi.mocked(db).mockReset();
});
test("initialization seeds only the provider while preserving saved configuration", () => {
  vi.mocked(loadConfig).mockReturnValue({ username: "candidate" });
  initCmd();
  expect(ensureHome).toHaveBeenCalledOnce();
  expect(db).toHaveBeenCalledOnce();
  expect(saveConfig).toHaveBeenCalledWith({
    provider: "opencode",
    username: "candidate",
  });
});
test("existing provider needs no rewrite and database errors propagate before config updates", () => {
  vi.mocked(loadConfig).mockReturnValue({ provider: "claude-code" });
  initCmd();
  expect(saveConfig).not.toHaveBeenCalled();
  vi.mocked(db).mockImplementation(() => {
    throw new Error("db failed");
  });
  expect(initCmd).toThrow("db failed");
  expect(saveConfig).not.toHaveBeenCalled();
});
