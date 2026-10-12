import { db, now } from "../db/index.ts";

/** Job lifecycle actions preserve linked application and interview history. */
export async function handleJobAction(
  path: string,
  req: Request,
  broadcast: (event: unknown) => void,
): Promise<Response> {
  const action = path.slice("/api/jobs/".length);
  if (!["archive", "restore", "delete"].includes(action))
    return Response.json({ error: "Not found." }, { status: 404 });
  if (req.method !== "POST")
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  const body: unknown = await req.json().catch(() => null);
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
        UNION ALL SELECT 1 FROM interviews WHERE job_id = ? LIMIT 1`).get(job.id, job.id);
      if (linked)
        return {
          error: "This job has linked applications or interviews. Archive it to keep their history.",
          status: 409,
        };
      d.query("DELETE FROM jobs WHERE id = ?").run(job.id);
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
