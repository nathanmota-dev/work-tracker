import { listInterviewPreps } from "./store.ts";

/** GET /api/interview-preps (all packs) or /api/interview-preps/<applicationId>: stored packs, newest first. */
export function handleInterviewPreps(path: string, req: Request): Response {
  if (req.method !== "GET") return new Response("not found", { status: 404 });
  const rest = path.slice("/api/interview-preps".length);
  if (rest === "") return Response.json(listInterviewPreps());
  const match = /^\/([1-9]\d*)$/.exec(rest);
  if (!match) return Response.json({ error: "application id must be a positive integer" }, { status: 400 });
  return Response.json(listInterviewPreps(Number(match[1])));
}
