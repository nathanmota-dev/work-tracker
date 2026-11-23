/**
 * Application deadline columns (schema v13), kept apart so `schema.ts` stays within the file-size limit.
 * Both hold a local date `YYYY-MM-DD`; an application's effective deadline is
 * `COALESCE(applications.deadline, jobs.deadline)`. See src/deadlines/urgency.ts.
 */
export const DEADLINE_COLUMNS: Record<string, Record<string, string>> = {
  jobs: { deadline: "TEXT" },
  applications: { deadline: "TEXT" },
};
