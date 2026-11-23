import { db } from "../db/index.ts";
import { ApplicationBoardError } from "../applications/validation.ts";
import { followUpDays, followupCandidates } from "./candidates.ts";
import { discardFollowup, listFollowups, markFollowupSent } from "./store.ts";
import { FollowupError } from "./types.ts";

type Broadcast = (event: unknown) => void;

function read(rest: string, query: URLSearchParams): Response {
  if (rest === "/candidates") return Response.json(followupCandidates(db(), { days: followUpDays(query.get("days")) }));
  if (rest !== "") return Response.json({ error: "Not found." }, { status: 404 });
  const application = query.get("application_id");
  if (application === null) return Response.json(listFollowups());
  if (!/^[1-9]\d*$/.test(application)) throw new FollowupError("application id must be a positive integer");
  return Response.json(listFollowups(Number(application)));
}

const writes: Record<string, typeof markFollowupSent> = { "/sent": markFollowupSent, "/discard": discardFollowup };

/**
 * GET /api/followups[?application_id=N], GET /api/followups/candidates[?days=N],
 * POST /api/followups/sent and /api/followups/discard with `{ id }`. Nothing
 * here sends a message: the user sends it and records the outcome.
 */
export async function handleFollowups(path: string, req: Request, broadcast: Broadcast): Promise<Response> {
  const rest = path.slice("/api/followups".length);
  try {
    if (req.method === "GET") return read(rest, new URL(req.url).searchParams);
    const write = Object.hasOwn(writes, rest) ? writes[rest] : undefined;
    if (req.method !== "POST" || !write)
      return write || rest === "" || rest === "/candidates"
        ? Response.json({ error: "Method not allowed." }, { status: 405 })
        : Response.json({ error: "Not found." }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || typeof body !== "object") throw new FollowupError("Invalid JSON body.");
    const result = write(body.id);
    if (result.changed) broadcast({ type: "changed", table: "followup_drafts" });
    return Response.json(result.draft);
  } catch (error) {
    if (error instanceof FollowupError || error instanceof ApplicationBoardError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
