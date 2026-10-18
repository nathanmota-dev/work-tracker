import { db } from "../db/index.ts";
import { JobError, saveJob } from "./store.ts";
import { normalizeSearchJob, type SearchSaveResult } from "./search-results.ts";

/** Each item owns its transaction: one failure cannot roll back successful siblings. */
export function saveSearchResults(body: unknown, broadcast: (event: unknown) => void): Response {
  const items = body && typeof body === "object" && "items" in body ? body.items : null;
  if (!Array.isArray(items) || !items.length || items.length > 500)
    return Response.json({ error: "Expected between 1 and 500 search results." }, { status: 400 });
  const keys = items.map(item => item && typeof item === "object" ? item.key : undefined);
  if (keys.some(key => typeof key !== "string" || !key.trim()) || new Set(keys).size !== keys.length)
    return Response.json({ error: "Each result needs a unique text key." }, { status: 400 });
  const results: SearchSaveResult[] = items.map((item) => {
    try {
      const normalized = normalizeSearchJob(item.result);
      if (!normalized.job) throw new JobError(normalized.error!);
      const saved = saveJob(db(), normalized.job);
      return { key: item.key, status: saved.existing ? "existing" : "saved", job: saved.job };
    } catch (error) {
      return { key: item.key, status: "failed", error: error instanceof JobError ? error.message : "Could not save this job. Try again." };
    }
  });
  if (results.some(result => result.status === "saved")) broadcast({ type: "changed", table: "jobs" });
  return Response.json({ results });
}
