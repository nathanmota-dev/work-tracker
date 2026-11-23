import { afterEach, beforeEach, expect, test } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { pendingDeadlines, pendingLevel } from "./queries.ts";

const today = "2026-11-23";
let d: Database;
beforeEach(async () => { d = await memoryDatabase(); });
afterEach(() => d.close());

test("lists only overdue and soon deadlines, soonest first, capped at the limit", () => {
  insertJob(d, { title: "Later", deadline: "2026-12-30" });
  insertJob(d, { title: "Soon", deadline: "2026-11-27" });
  insertJob(d, { title: "Overdue", deadline: "2026-11-01" });
  insertJob(d, { title: "No deadline" });
  insertJob(d, { title: "Bad value", deadline: "2026-02-31" });
  expect(pendingDeadlines(d, today).map(item => [item.title, item.level, item.days_left])).toEqual([
    ["Overdue", "overdue", -22], ["Soon", "soon", 4],
  ]);
  for (let i = 0; i < 6; i++) insertJob(d, { title: `Extra ${i}`, deadline: "2026-11-24" });
  expect(pendingDeadlines(d, today)).toHaveLength(5);
  expect(pendingDeadlines(d, today, 2)).toHaveLength(2);
});

test("archived jobs and jobs whose application was sent stay out", () => {
  insertJob(d, { title: "Archived", deadline: "2026-11-24", archived_at: "2026-11-01" });
  const sent = insertJob(d, { title: "Sent", deadline: "2026-11-24" });
  insertApplication(d, { job_id: sent, submission_status: "submitted", tracking_status: "active" });
  expect(pendingDeadlines(d, today)).toEqual([]);
});

test("an unsent application uses its own deadline, then the job's, and replaces the job entry", () => {
  const job = insertJob(d, { title: "Role", company_name: "Acme", deadline: "2026-11-25" });
  const draft = insertApplication(d, { job_id: job });
  expect(pendingDeadlines(d, today)).toEqual([
    { kind: "application", id: draft, title: "Role", company: "Acme", deadline: "2026-11-25", level: "soon", days_left: 2 },
  ]);
  d.query("UPDATE applications SET deadline = '2026-11-20' WHERE id = ?").run(draft);
  expect(pendingDeadlines(d, today)[0]).toMatchObject({ kind: "application", deadline: "2026-11-20", level: "overdue" });
  d.query("UPDATE applications SET submission_status = 'submitted', tracking_status = 'active' WHERE id = ?").run(draft);
  expect(pendingDeadlines(d, today)).toEqual([]);
});

test("archived applications and manual applications without a job are handled", () => {
  const archived = insertApplication(d, { company_name: "Gone", deadline: "2026-11-24", tracking_status: "archived" });
  const manual = insertApplication(d, { company_name: "Solo", role_title: "Dev", deadline: "2026-11-24" });
  expect(archived).not.toBe(manual);
  expect(pendingDeadlines(d, today).map(item => item.id)).toEqual([manual]);
});

test("pendingLevel is none once nothing is pending", () => {
  expect(pendingLevel("2026-11-24", true, today)).toBe("soon");
  expect(pendingLevel("2026-11-24", false, today)).toBe("none");
  expect(pendingLevel(null, true, today)).toBe("none");
});
