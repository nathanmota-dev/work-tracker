import { beforeEach, expect, test, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { databaseDouble } from "../test/doubles.ts";
import { Database } from "./sqlite.ts";
import { snapshotDatabase } from "./snapshot.ts";
vi.mock("node:fs", () => ({
  chmodSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}));
vi.mock("./sqlite.ts", () => ({ Database: vi.fn() }));
let source: ReturnType<typeof databaseDouble>, copy: ReturnType<typeof databaseDouble>;
beforeEach(() => {
  source = databaseDouble();
  copy = databaseDouble();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(Database).mockImplementation(function () {
    return copy.asDatabase;
  });
  copy.statement.get.mockReturnValue({ quick_check: "ok" });
});

test("vacuums into a private partial file, verifies it, then moves it into place", () => {
  expect(snapshotDatabase(source.asDatabase, "/home/backups/copy.db")).toBe("/home/backups/copy.db");
  expect(mkdirSync).toHaveBeenCalledWith("/home/backups", { recursive: true, mode: 0o700 });
  expect(source.query).toHaveBeenCalledWith("VACUUM INTO ?");
  expect(source.statement.run).toHaveBeenCalledWith("/home/backups/copy.db.partial");
  expect(chmodSync).toHaveBeenCalledWith("/home/backups/copy.db.partial", 0o600);
  expect(Database).toHaveBeenCalledWith("/home/backups/copy.db.partial");
  expect(copy.close).toHaveBeenCalledOnce();
  expect(renameSync).toHaveBeenCalledWith("/home/backups/copy.db.partial", "/home/backups/copy.db");
});
test("never overwrites an existing snapshot", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  expect(() => snapshotDatabase(source.asDatabase, "/b/copy.db")).toThrow("already exists");
  expect(source.query).not.toHaveBeenCalled();
});
test.each([
  [{ quick_check: "page 2 is never used" }, "page 2 is never used"],
  [undefined, "no result"],
])("removes a copy that fails its integrity check (%o)", (result, message) => {
  copy.statement.get.mockReturnValue(result);
  expect(() => snapshotDatabase(source.asDatabase, "/b/copy.db")).toThrow(message);
  expect(copy.close).toHaveBeenCalledOnce();
  expect(renameSync).not.toHaveBeenCalled();
  expect(rmSync).toHaveBeenLastCalledWith("/b/copy.db.partial", { force: true });
});
test("removes the partial file when vacuum fails", () => {
  source.statement.run.mockImplementation(() => {
    throw new Error("disk full");
  });
  expect(() => snapshotDatabase(source.asDatabase, "/b/copy.db")).toThrow("disk full");
  expect(rmSync).toHaveBeenCalledTimes(2);
  expect(Database).not.toHaveBeenCalled();
});
