import type { Database } from "../db/sqlite.ts";
import { deadlineUrgency, localToday, type DeadlineLevel } from "./urgency.ts";

export const DASHBOARD_DEADLINES = 5;

export interface DeadlineItem {
  kind: "job" | "application";
  id: number;
  title: string | null;
  company: string | null;
  deadline: string;
  level: "overdue" | "soon";
  days_left: number;
}

/** Urgency of a deadline that still matters; `none` once nothing is pending. */
export function pendingLevel(deadline: string | null, pending: boolean, today?: string): DeadlineLevel {
  return pending ? deadlineUrgency(deadline, today).level : "none";
}

/** Drafts and prepared applications count; a confirmed submission or an archived record does not. */
export const applicationPendingSql = (a = "a") =>
  `${a}.submission_status != 'submitted' AND COALESCE(${a}.tracking_status, '') != 'archived'`;

type Row = { id: number; title: string | null; company: string | null; deadline: string };

/**
 * Pending deadlines for the Dashboard: overdue first, then the soonest.
 * A saved job that already has an application is listed through that application only.
 */
export function pendingDeadlines(d: Database, today: string = localToday(), limit = DASHBOARD_DEADLINES): DeadlineItem[] {
  const jobs = d.query(`
    SELECT j.id, j.title, j.company_name AS company, j.deadline FROM jobs j
    WHERE j.archived_at IS NULL AND j.deadline IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id
        AND (a.submission_status = 'submitted' OR COALESCE(a.tracking_status, '') != 'archived'))`).all() as Row[];
  const applications = d.query(`
    SELECT a.id, COALESCE(a.role_title, j.title) AS title, COALESCE(a.company_name, j.company_name) AS company,
           COALESCE(a.deadline, j.deadline) AS deadline
    FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
    WHERE ${applicationPendingSql()} AND j.archived_at IS NULL AND COALESCE(a.deadline, j.deadline) IS NOT NULL`).all() as Row[];
  const items: DeadlineItem[] = [];
  const add = (kind: DeadlineItem["kind"], rows: Row[]) => {
    for (const row of rows) {
      const { level, daysLeft } = deadlineUrgency(row.deadline, today);
      if ((level === "overdue" || level === "soon") && daysLeft !== null) items.push({ kind, ...row, level, days_left: daysLeft });
    }
  };
  add("job", jobs);
  add("application", applications);
  return items.sort((a, b) => a.deadline.localeCompare(b.deadline) || a.id - b.id).slice(0, limit);
}
