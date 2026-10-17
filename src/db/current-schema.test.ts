import { expect, test } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { ensureCurrentSchema } from "./current-schema.ts";
import { APPLICATION_BOARD_INDEX_SQL, COLUMN_MIGRATIONS, DEFAULT_APPLICATION_STAGES, SCHEMA_SQL } from "./schema.ts";

test("creates the schema, adds only missing columns, then board indexes, stages and the budget seed", () => {
  const d = databaseDouble();
  const existing = [...Object.keys(COLUMN_MIGRATIONS.applications!), ...Object.keys(COLUMN_MIGRATIONS.jobs!)];
  d.statement.all.mockReturnValue(existing.filter((c) => c !== "external_url").map((name) => ({ name })));
  d.statement.get.mockReturnValue(undefined);
  ensureCurrentSchema(d.asDatabase);
  const sql = d.exec.mock.calls.map(([statement]) => String(statement));
  expect(sql[0]).toBe(SCHEMA_SQL);
  expect(sql.filter((statement) => statement.startsWith("ALTER TABLE"))).toEqual([
    "ALTER TABLE applications ADD COLUMN external_url TEXT",
  ]);
  expect(sql.indexOf(APPLICATION_BOARD_INDEX_SQL)).toBeGreaterThan(sql.indexOf(SCHEMA_SQL));
  expect(sql.at(-1)).toContain("INSERT INTO outreach_budget");
  expect(d.statement.run).toHaveBeenCalledTimes(DEFAULT_APPLICATION_STAGES.length);
  expect(d.statement.run).toHaveBeenCalledWith("applied", "Applied", "applied", 0, expect.any(String), expect.any(String));
});
test("keeps an existing budget row", () => {
  const d = databaseDouble();
  d.statement.get.mockReturnValue({ 1: 1 });
  ensureCurrentSchema(d.asDatabase);
  expect(d.exec).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO outreach_budget"));
});
