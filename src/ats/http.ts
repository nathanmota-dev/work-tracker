import { db } from "../db/index.ts";
import { currentSourceVersion } from "../variants/service.ts";
import { AtsError, readBest, readJob } from "./store.ts";

/**
 * GET /api/ats/best and GET /api/ats/jobs/:id. Scores are refreshed on read, so
 * they always reflect the current descriptions and PDFs; nothing runs in the background.
 */
export function handleAts(path: string, req: Request): Response {
  if (req.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
  try {
    if (path === "/api/ats/best") return Response.json(readBest(db(), currentSourceVersion));
    const job = /^\/api\/ats\/jobs\/(\d+)$/.exec(path);
    if (job) return Response.json(readJob(db(), Number(job[1]), currentSourceVersion));
    return Response.json({ error: "Not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof AtsError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
