import type { Database } from "../db/sqlite.ts";
import {
  APPLICATION_ORIGINS,
  APPLICATION_VIEWS,
  JOURNEY_PHASES,
  type ApplicationOrigin,
  type ApplicationSummary,
  type ApplicationView,
  type JourneyPhase,
} from "./journey.ts";
export type { ApplicationSummary };

/**
 * Furthest step an application reached, as SQL over the row alias `a`. Phases
 * are mutually exclusive, so drafts are never counted as submitted. Used by the
 * Applications list, Jobs, the board summary and the dashboard alike.
 */
export const phaseSql = (a = "a") => `CASE
  WHEN ${a}.submission_status = 'submitted' THEN 'submitted'
  WHEN ${a}.fill_status IN ('filled', 'needs_input') THEN 'filled'
  WHEN ${a}.preparation_status = 'ready' THEN 'prepared'
  ELSE 'draft' END`;

/** Where the record lives: the board's Active/Archived tabs, or still in preparation. */
export const viewSql = (a = "a") => `CASE ${a}.tracking_status
  WHEN 'active' THEN 'tracking' WHEN 'archived' THEN 'archived' ELSE 'preparation' END`;

const zero = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

export function applicationSummary(d: Database): ApplicationSummary {
  const rows = d
    .query(`SELECT ${phaseSql()} AS phase, ${viewSql()} AS view, a.origin AS origin, COUNT(*) AS n,
        SUM(a.preparation_status = 'ready') AS ready_resumes,
        SUM(a.fill_status = 'needs_input') AS needs_input
      FROM applications a GROUP BY 1, 2, 3`)
    .all() as Array<{ phase: JourneyPhase; view: ApplicationView; origin: ApplicationOrigin; n: number; ready_resumes: number; needs_input: number }>;
  const summary: ApplicationSummary = {
    total: 0,
    phases: zero(JOURNEY_PHASES),
    views: zero(APPLICATION_VIEWS),
    origins: zero(APPLICATION_ORIGINS),
    overlaps: { ready_resumes: 0, needs_input: 0, submitted_archived: 0, submitted_untracked: 0 },
  };
  for (const row of rows) {
    summary.total += row.n;
    summary.phases[row.phase] += row.n;
    summary.views[row.view] += row.n;
    summary.origins[row.origin] = (summary.origins[row.origin] ?? 0) + row.n;
    summary.overlaps.ready_resumes += row.ready_resumes;
    summary.overlaps.needs_input += row.needs_input;
    if (row.phase === "submitted" && row.view === "archived") summary.overlaps.submitted_archived += row.n;
    if (row.phase === "submitted" && row.view === "preparation") summary.overlaps.submitted_untracked += row.n;
  }
  return summary;
}
