import { JobError, saveJob, shortlistJob, type Job } from "./store.ts";
import { db, now } from "../db/index.ts";
import { saveSearchResults } from "./search-save.ts";
import { importJob } from "./import.ts";

/** Job lifecycle actions preserve linked application and interview history. */
export async function handleJobAction(
  path: string,
  req: Request,
  broadcast: (event: unknown) => void,
): Promise<Response> {
  const action = path.slice("/api/jobs/".length);
  if (!["save-search", "import", "create", "update", "shortlist", "archive", "restore", "delete"].includes(action))
    return Response.json({ error: "Not found." }, { status: 404 });
  if (req.method !== "POST")
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  const body: unknown = await req.json().catch(() => null);
  if (action === "save-search") return saveSearchResults(body, broadcast);
  if (action === "import") {
    try { return Response.json(await importJob(body)); }
    catch (error) {
      if (!(error instanceof JobError)) throw error;
      return Response.json({ error: error.message }, { status: error.status });
    }
  }
  if (action === "create" || action === "update") {
    try {
      if (action === "update" && (!body || typeof body !== "object" || !("id" in body)
        || typeof body.id !== "number" || !Number.isSafeInteger(body.id) || body.id <= 0))
        throw new JobError("Expected a positive job id.");
      const d = db();
      let result = saveJob(d, body, action === "update" ? (body as { id: number }).id : undefined);
      // A job added by hand is already a choice; only discovered jobs wait in New.
      if (result.created) {
        shortlistJob(d, result.job.id);
        result = { ...result, job: d.query("SELECT * FROM jobs WHERE id = ?").get(result.job.id) as Job };
      }
      if (!result.existing) broadcast({ type: "changed", table: "jobs" });
      return Response.json(result, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (!(error instanceof JobError)) throw error;
      return Response.json({ error: error.message, existing_id: error.existingId }, { status: error.status });
    }
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("id" in body) ||
    typeof body.id !== "number" ||
    !Number.isSafeInteger(body.id) ||
    body.id <= 0
  )
    return Response.json({ error: "Expected a positive job id." }, { status: 400 });

  const id = body.id;
  const d = db();
  const result = d.transaction(() => {
    const job = d.query("SELECT id, archived_at FROM jobs WHERE id = ?").get(id) as
      { id: number; archived_at: string | null } | undefined;
    if (!job)
      return { error: "Job not found.", status: 404 };
    if (action === "delete") {
      const linked = d.query(`SELECT 1 FROM applications WHERE job_id = ?
        UNION ALL SELECT 1 FROM interviews WHERE job_id = ?
        UNION ALL SELECT 1 FROM application_runs WHERE job_id = ? LIMIT 1`).get(job.id, job.id, job.id);
      if (linked)
        return {
          error: "This job has linked applications or interviews. Archive it to keep their history.",
          status: 409,
        };
      d.query("DELETE FROM jobs WHERE id = ?").run(job.id);
    } else if (action === "shortlist") {
      if (job.archived_at) return { error: "Restore this job before moving it to the shortlist.", status: 409 };
      shortlistJob(d, job.id);
    } else {
      d.query("UPDATE jobs SET archived_at = ? WHERE id = ?").run(
        action === "archive" ? job.archived_at ?? now() : null,
        job.id,
      );
    }
    return { error: null, status: 200 };
  })();
  if (result.error)
    return Response.json({ error: result.error }, { status: result.status });
  broadcast({ type: "changed", table: "jobs" });
  return Response.json({ ok: true });
}
