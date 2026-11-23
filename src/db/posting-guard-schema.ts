/**
 * Posting integrity guard result (schema v14), kept apart so `schema.ts` stays within
 * the file-size limit. Holds the stored check of `jobs.description`; see
 * src/postings/description.ts.
 */
export const POSTING_GUARD_COLUMNS: Record<string, Record<string, string>> = {
  jobs: { description_guard_json: "TEXT" },
};
