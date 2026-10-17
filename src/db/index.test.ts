import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { Database } from "./sqlite.ts";
import { ensureHome, paths } from "../paths.ts";
import { migrateDatabase } from "./migrations.ts";
vi.mock("./sqlite.ts", () => ({ Database: vi.fn() }));
vi.mock("./migrations.ts", () => ({ migrateDatabase: vi.fn() }));
vi.mock("../paths.ts", () => ({
  ensureHome: vi.fn(),
  paths: { db: "/private/db", backups: "/private/backups" },
}));
beforeEach(() => {
  vi.resetModules();
  vi.mocked(migrateDatabase).mockReset();
});

test("opens once, enables pragmas before migrating into the workspace backup directory", async () => {
  const d = databaseDouble();
  vi.mocked(Database).mockImplementation(function () {
    return d.asDatabase;
  });
  vi.mocked(migrateDatabase).mockImplementation(() => {
    expect(d.exec.mock.calls.map(([sql]) => sql)).toEqual([
      "PRAGMA journal_mode = WAL;",
      "PRAGMA foreign_keys = ON;",
      "PRAGMA busy_timeout = 5000;",
    ]);
    return { mode: "current", from: 3, to: 3, applied: [], backup: null };
  });
  const { db, closeDb } = await import("./index.ts");
  expect(db()).toBe(d.asDatabase);
  expect(db()).toBe(d.asDatabase);
  expect(Database).toHaveBeenCalledExactlyOnceWith(paths.db, { create: true });
  expect(ensureHome).toHaveBeenCalledOnce();
  expect(migrateDatabase).toHaveBeenCalledExactlyOnceWith(d.asDatabase, { backupDir: paths.backups });
  closeDb();
  closeDb();
  expect(d.close).toHaveBeenCalledOnce();
});
test("closes a database whose migration fails and retries on the next open", async () => {
  const first = databaseDouble(),
    next = databaseDouble();
  vi.mocked(Database)
    .mockImplementationOnce(function () {
      return first.asDatabase;
    })
    .mockImplementationOnce(function () {
      return next.asDatabase;
    });
  vi.mocked(migrateDatabase).mockImplementationOnce(() => {
    throw new Error("migration failed");
  });
  const { db, closeDb, now } = await import("./index.ts");
  expect(db).toThrow("migration failed");
  expect(first.close).toHaveBeenCalledOnce();
  expect(db()).toBe(next.asDatabase);
  expect(next.close).not.toHaveBeenCalled();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  expect(now()).toBe("2026-10-10T12:00:00.000Z");
  closeDb();
  expect(Database).toHaveBeenCalledTimes(2);
});
