import { beforeEach, expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Database } from "./sqlite.ts";
const statement = { all: vi.fn(), get: vi.fn(), run: vi.fn() };
const connection = {
  prepare: vi.fn(() => statement),
  exec: vi.fn(),
  close: vi.fn(),
};
beforeEach(() => {
  connection.exec.mockReset();
  vi.mocked(DatabaseSync).mockImplementation(function () {
    return connection as unknown as DatabaseSync;
  });
});
test("passes positional and named bindings unchanged and exposes driver results", () => {
  const d = new Database("/mock/db");
  expect(DatabaseSync).toHaveBeenCalledWith("/mock/db");
  const q = d.query("SELECT ?");
  statement.all.mockReturnValue([{ value: "safe" }]);
  statement.get.mockReturnValue({ value: 3 });
  statement.run.mockReturnValue({ changes: 2n, lastInsertRowid: 7n });
  expect(q.all("quote'; --", null, 2)).toEqual([{ value: "safe" }]);
  expect(statement.all).toHaveBeenCalledWith("quote'; --", null, 2);
  expect(q.get({ $value: 3 })).toEqual({ value: 3 });
  expect(statement.get).toHaveBeenCalledWith({ $value: 3 });
  expect(q.run()).toEqual({ changes: 2n, lastInsertRowid: 7n });
  d.close();
  expect(connection.close).toHaveBeenCalledOnce();
});
test("nested rollback keeps outer transaction open, returns callback values and forwards arguments", () => {
  const d = new Database(":mock:");
  const nested = d.transaction(() => {
    throw new Error("inner");
  });
  expect(
    d.transaction((input: number) => {
      expect(nested).toThrow("inner");
      return input + 1;
    })(4),
  ).toBe(5);
  expect(connection.exec.mock.calls.map(([sql]) => sql)).toEqual([
    "BEGIN IMMEDIATE",
    "SAVEPOINT wt_1",
    "ROLLBACK TO wt_1; RELEASE wt_1",
    "COMMIT",
  ]);
  connection.exec.mockClear();
  d.transaction(() => d.transaction(() => 9)())();
  expect(connection.exec.mock.calls.map(([sql]) => sql)).toEqual([
    "BEGIN IMMEDIATE",
    "SAVEPOINT wt_1",
    "RELEASE wt_1",
    "COMMIT",
  ]);
});
test("outer failure and async callbacks rollback; a failed BEGIN restores nesting depth", () => {
  const d = new Database(":mock:");
  expect(
    d.transaction(() => {
      throw new Error("outer");
    }),
  ).toThrow("outer");
  expect(connection.exec).toHaveBeenLastCalledWith("ROLLBACK");
  expect(d.transaction(() => Promise.resolve(1))).toThrow(
    "must be synchronous",
  );
  connection.exec.mockImplementationOnce(() => {
    throw new Error("busy");
  });
  expect(d.transaction(() => 1)).toThrow("busy");
  connection.exec.mockClear();
  expect(d.transaction(() => 2)()).toBe(2);
  expect(connection.exec.mock.calls.map(([sql]) => sql)).toEqual([
    "BEGIN IMMEDIATE",
    "COMMIT",
  ]);
});
test("opens read-only connections when asked", () => {
  new Database("/mock/db", { readOnly: true });
  expect(DatabaseSync).toHaveBeenCalledWith("/mock/db", { readOnly: true });
});
