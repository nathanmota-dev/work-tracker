import { gateProfile, removeLanguage, saveLanguage, setEligibility } from "./profile-store.ts";
import { jobGate } from "./store.ts";
import { GateError, type GateProfile } from "./types.ts";

type Broadcast = (event: unknown) => void;
type Body = Record<string, unknown>;

const writes: Record<string, (body: Body) => GateProfile> = {
  "/languages": (body) => (body.action === "remove" ? removeLanguage(body) : saveLanguage(body)),
  "/eligibility": (body) => setEligibility(body.eligibility),
};

function read(rest: string): Response {
  if (rest === "/profile") return Response.json(gateProfile());
  const job = /^\/jobs\/([1-9]\d*)$/.exec(rest);
  if (job) return Response.json({ gate: jobGate(Number(job[1])) });
  return Response.json({ error: "Not found." }, { status: 404 });
}

/**
 * GET /api/gates/profile and /api/gates/jobs/:id (the stored check with its
 * quotes, for the job detail); POST /api/gates/languages (`action: "remove"`
 * removes) and /api/gates/eligibility. A profile write re-evaluates every
 * stored check, so jobs are announced as changed too.
 */
export async function handleGates(path: string, req: Request, broadcast: Broadcast): Promise<Response> {
  const rest = path.slice("/api/gates".length);
  try {
    if (req.method === "GET") return read(rest);
    const write = Object.hasOwn(writes, rest) ? writes[rest] : undefined;
    if (!write) return Response.json({ error: rest === "/profile" ? "Method not allowed." : "Not found." }, { status: rest === "/profile" ? 405 : 404 });
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new GateError("Invalid JSON body.");
    const profile = write(body);
    broadcast({ type: "changed", table: rest === "/languages" ? "candidate_languages" : "gate_profile" });
    broadcast({ type: "changed", table: "jobs" });
    return Response.json(profile);
  } catch (error) {
    if (error instanceof GateError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
