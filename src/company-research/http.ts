import { describeLookup, getCompanyResearch, invalidateCompanyResearch } from "./store.ts";
import { CompanyResearchError } from "./sources.ts";

type Broadcast = (event: unknown) => void;

function companyOf(value: unknown): string {
  const company = typeof value === "string" ? value.trim() : "";
  if (!company) throw new CompanyResearchError("company is required");
  return company;
}

/**
 * GET /api/company-research?company=<name>: the cached research of a company, stale or not, with its age.
 * POST /api/company-research/invalidate {company}: forgets it so the next skill run researches again.
 */
export async function handleCompanyResearch(path: string, req: Request, broadcast: Broadcast): Promise<Response> {
  try {
    if (req.method === "GET" && path === "/api/company-research") {
      const company = companyOf(new URL(req.url).searchParams.get("company"));
      return Response.json(describeLookup(company, getCompanyResearch(company, { allowStale: true })));
    }
    if (req.method === "POST" && path === "/api/company-research/invalidate") {
      const body = (await req.json().catch(() => null)) as { company?: unknown } | null;
      const removed = invalidateCompanyResearch(companyOf(body?.company));
      if (removed) broadcast({ type: "changed", table: "company_research" });
      return Response.json({ removed });
    }
  } catch (error) {
    if (error instanceof CompanyResearchError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
  return new Response("not found", { status: 404 });
}
