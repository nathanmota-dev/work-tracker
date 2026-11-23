import { db } from "../db/index.ts";
import { rankingCandidates, rankingJobIds, rankingLimit } from "./candidates.ts";
import { listRankings } from "./list.ts";
import { RankingError } from "./types.ts";

/** Parses `all` as a flag: absent, `1`/`true` or `0`/`false`. */
export function rankingAll(value: string | null): boolean {
  if (value === null || value === "" || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new RankingError("all must be true or false");
}

function candidates(query: URLSearchParams): Response {
  const result = rankingCandidates(db(), {
    limit: rankingLimit(query.get("limit")),
    all: rankingAll(query.get("all")),
    jobIds: rankingJobIds(query.get("job_ids")),
  });
  // The interface needs counts and titles; posting text stays with the skill.
  return Response.json({ ...result, items: result.items.map(({ description, ...item }) => ({ ...item, has_description: !!description })) });
}

/**
 * GET /api/rankings and GET /api/rankings/candidates?limit=&all=&job_ids=.
 * Rankings are written only by the triage skill through `work-tracker ranking save`,
 * which notifies the dashboard with a `job_rankings` change.
 */
export function handleRankings(path: string, req: Request): Response {
  const rest = path.slice("/api/rankings".length);
  if (rest !== "" && rest !== "/candidates") return Response.json({ error: "Not found." }, { status: 404 });
  if (req.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
  try {
    return rest === "" ? Response.json(listRankings(db())) : candidates(new URL(req.url).searchParams);
  } catch (error) {
    if (error instanceof RankingError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
