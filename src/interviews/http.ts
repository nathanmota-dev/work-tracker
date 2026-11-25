import { db } from "../db/index.ts";

const STATUSES = new Set(["scheduled", "done", "closed", "cancelled"]);

type Fields = { company: string; scheduled_at: string | null; stage: string | null; status: string; notes: string | null };

function optional(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Validates a create or update body; returns an error message instead of throwing. */
function fields(body: Record<string, unknown>): Fields | string {
  const company = optional(body.company);
  if (!company) return "Company is required.";
  const status = optional(body.status) ?? "scheduled";
  if (!STATUSES.has(status)) return `Status must be one of ${[...STATUSES].join(", ")}.`;
  const scheduled = optional(body.scheduled_at);
  if (scheduled && Number.isNaN(new Date(scheduled).getTime())) return "Schedule must be a valid date.";
  return { company, scheduled_at: scheduled, stage: optional(body.stage), status, notes: optional(body.notes) };
}

function positiveId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** POST /api/interviews/{create,update,delete}: interviews added and edited by hand. */
export async function handleInterviews(path: string, req: Request, broadcast: (event: unknown) => void): Promise<Response> {
  const action = path.slice("/api/interviews/".length);
  if (!["create", "update", "delete"].includes(action)) return Response.json({ error: "Not found." }, { status: 404 });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  const id = positiveId(body.id);
  if (action !== "create" && !id) return Response.json({ error: "Expected a positive interview id." }, { status: 400 });
  const d = db();
  if (id && !d.query("SELECT 1 FROM interviews WHERE id = ?").get(id)) return Response.json({ error: "Interview not found." }, { status: 404 });
  if (action === "delete") {
    d.query("DELETE FROM interviews WHERE id = ?").run(id);
    broadcast({ type: "changed", table: "interviews" });
    return Response.json({ ok: true });
  }
  const values = fields(body);
  if (typeof values === "string") return Response.json({ error: values }, { status: 400 });
  const params = { $company: values.company, $when: values.scheduled_at, $stage: values.stage, $status: values.status, $notes: values.notes };
  const saved = action === "create"
    ? d.query(`INSERT INTO interviews (company, scheduled_at, stage, status, notes)
        VALUES ($company, $when, $stage, $status, $notes) RETURNING id`).get(params) as { id: number }
    : (d.query(`UPDATE interviews SET company = $company, scheduled_at = $when, stage = $stage, status = $status, notes = $notes
        WHERE id = $id`).run({ ...params, $id: id }), { id: id! });
  broadcast({ type: "changed", table: "interviews" });
  return Response.json({ id: saved.id }, { status: action === "create" ? 201 : 200 });
}
