import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { Database } from "./sqlite.ts";
import { ensureHome, paths } from "../paths.ts";
import { COLUMN_MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";
vi.mock("./sqlite.ts", () => ({ Database: vi.fn() }));
vi.mock("../paths.ts", () => ({
  ensureHome: vi.fn(),
  paths: { db: "/private/db" },
}));
beforeEach(() => vi.resetModules());

test("opens once, enables pragmas, adds only missing columns and seeds budget in the schema transaction", async () => {
  const d = databaseDouble();
  vi.mocked(Database).mockImplementation(function () {
    return d.asDatabase;
  });
  const existing = Object.keys(COLUMN_MIGRATIONS.applications);
  d.statement.all.mockReturnValue(
    existing.filter((c) => c !== "external_url").map((name) => ({ name })),
  );
  d.statement.get.mockReturnValue(undefined);
  const { db, closeDb } = await import("./index.ts");
  expect(db()).toBe(d.asDatabase);
  expect(db()).toBe(d.asDatabase);
  expect(Database).toHaveBeenCalledExactlyOnceWith(paths.db, { create: true });
  expect(ensureHome).toHaveBeenCalledOnce();
  expect(d.exec.mock.calls.slice(0, 4).map(([sql]) => sql)).toEqual([
    "PRAGMA journal_mode = WAL;",
    "PRAGMA foreign_keys = ON;",
    "PRAGMA busy_timeout = 5000;",
    SCHEMA_SQL,
  ]);
  expect(d.exec).toHaveBeenCalledWith(
    expect.stringContaining("ADD COLUMN external_url"),
  );
  expect(
    d.exec.mock.calls.filter(([sql]) => String(sql).startsWith("ALTER TABLE")),
  ).toHaveLength(1);
  expect(d.exec).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO outreach_budget"),
  );
  expect(d.statement.run).toHaveBeenCalledWith(String(SCHEMA_VERSION));
  expect(d.transaction).toHaveBeenCalledOnce();
  closeDb();
  closeDb();
  expect(d.close).toHaveBeenCalledOnce();
});
test("does not reseed an existing budget and closes a failed migration before retrying", async () => {
  const first = databaseDouble(),
    next = databaseDouble();
  first.statement.all.mockImplementation(() => {
    throw new Error("migration failed");
  });
  next.statement.all.mockReturnValue(
    Object.keys(COLUMN_MIGRATIONS.applications).map((name) => ({ name })),
  );
  next.statement.get.mockReturnValue({ 1: 1 });
  vi.mocked(Database)
    .mockImplementationOnce(function () {
      return first.asDatabase;
    })
    .mockImplementationOnce(function () {
      return next.asDatabase;
    });
  const { db, closeDb, now } = await import("./index.ts");
  expect(db).toThrow("migration failed");
  expect(first.close).toHaveBeenCalledOnce();
  expect(db()).toBe(next.asDatabase);
  expect(next.exec).not.toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO outreach_budget"),
  );
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  expect(now()).toBe("2026-10-10T12:00:00.000Z");
  closeDb();
  vi.mocked(Database).mockImplementation(function () {
    return next.asDatabase;
  });
  db();
  expect(Database).toHaveBeenCalledTimes(3);
  closeDb();
});
