import { expect, test } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { applicationSummary, phaseSql, viewSql } from "./journey-summary.ts";

test("phases and views are mutually exclusive CASE expressions over one alias", () => {
  expect(phaseSql("x")).toContain("WHEN x.submission_status = 'submitted' THEN 'submitted'");
  expect(phaseSql("x").indexOf("submitted")).toBeLessThan(phaseSql("x").indexOf("filled"));
  expect(viewSql("x")).toContain("CASE x.tracking_status");
});

test("summary splits each group once per dimension and reports overlaps", () => {
  const d = databaseDouble();
  d.statement.all.mockReturnValueOnce([
    { phase: "draft", view: "preparation", origin: "manual", n: 2, ready_resumes: 0, needs_input: 0 },
    { phase: "filled", view: "preparation", origin: "preparation", n: 1, ready_resumes: 1, needs_input: 1 },
    { phase: "submitted", view: "tracking", origin: "preparation", n: 3, ready_resumes: 3, needs_input: 0 },
    { phase: "submitted", view: "archived", origin: "agent", n: 1, ready_resumes: 0, needs_input: 0 },
    { phase: "submitted", view: "preparation", origin: "unknown", n: 1, ready_resumes: 0, needs_input: 0 },
  ]);
  expect(applicationSummary(d.asDatabase)).toEqual({
    total: 8,
    phases: { draft: 2, prepared: 0, filled: 1, submitted: 5 },
    views: { preparation: 4, tracking: 3, archived: 1 },
    origins: { preparation: 4, manual: 2, agent: 1, unknown: 1 },
    overlaps: { ready_resumes: 4, needs_input: 1, submitted_archived: 1, submitted_untracked: 1 },
  });
});

test("an empty workspace reports zero for every key", () => {
  const summary = applicationSummary(databaseDouble().asDatabase);
  expect(summary.total).toBe(0);
  expect(Object.values(summary.phases)).toEqual([0, 0, 0, 0]);
  expect(Object.values(summary.views)).toEqual([0, 0, 0]);
});
