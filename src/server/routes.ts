import { db } from "../db/index.ts";
import { queries } from "./queries.ts";
import type { SessionManager } from "../acp/session.ts";
import { PROVIDERS, listProviderModels } from "../acp/providers.ts";
import { loadConfig } from "../paths.ts";
import { chromeLoginOpening, openChromeLogin } from "../mcp/chrome.ts";
import { handleApplicationBoard } from "../applications/http.ts";
import { handleJobAction } from "../jobs/http.ts";
import { PreparationService } from "../preparation/service.ts";
import { handlePreparation } from "../preparation/http.ts";
import { PreparationQueue } from "../preparation/batch-queue.ts";
import { handleBatches } from "../preparation/batch-http.ts";
import { handleIntegrations, integrationTesting } from "../integrations/http.ts";
import { handlePermissions } from "../acp/permission-http.ts";
import { handleWorkspaceBackup } from "../backup/http.ts";

import { handleAnswer } from "../answers/http.ts";
import { handleOnboarding } from "../onboarding/http.ts";
import { handleInterviewPreps } from "../interview-prep/http.ts";
import { handleFollowups } from "../followups/http.ts";

type Acp = Pick<SessionManager, "run" | "cancel"> & Partial<Pick<SessionManager, "isRunning" | "permissions">>;
type Broadcast = (event: unknown) => void;
type Context = { acp: Acp; broadcast: Broadcast; preparation?: PreparationService; queue?: PreparationQueue };
type Route = (req: Request, context: Context) => Promise<Response> | Response;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openBrowserLogin(_req: Request, { acp, preparation }: Context): Promise<Response> {
  if (acp.isRunning || preparation?.isBusy || integrationTesting()) return Response.json({ error: "Finish or cancel the active agent run or diagnostic before opening browser sign-in." }, { status: 409 });
  try {
    await openChromeLogin();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 502 });
  }
}

async function listProviders(): Promise<Response> {
  const cfg = loadConfig();
  const providerEntries = await Promise.all(
    Object.values(PROVIDERS).map(async (p) => ({
      id: p.id,
      displayName: p.displayName,
      models: await listProviderModels(p.id),
      defaultModel: p.defaultModel,
      efforts: p.efforts,
    })),
  );
  return Response.json({
    providers: providerEntries,
    default: cfg.provider ?? "opencode",
  });
}

async function runAgent(req: Request, { acp, preparation }: Context): Promise<Response> {
  if (preparation?.isBusy || acp.isRunning || integrationTesting()) return Response.json({ error: "Finish or cancel the active execution or diagnostic first." }, { status: 409 });
  if (chromeLoginOpening()) return Response.json({ error: "Wait for the sign-in browser to open before starting your agent." }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    skill?: string;
    params?: Record<string, string>;
    model?: string;
    effort?: string;
  };
  const provider = body.provider ?? "opencode";
  if (body.effort && !PROVIDERS[provider]?.efforts.includes(body.effort)) return Response.json({ error: `Unsupported effort for ${provider}: ${body.effort}` }, { status: 400 });
  if (body.skill?.replace(/^work-tracker-/, "") === "portal-filler") return Response.json({ error: "Use Apply to review and approve a document version before filling its portal." }, { status: 409 });
  // Fire and forget — progress streams over the WebSocket.
  void acp.run(
    provider,
    body.skill ?? "",
    body.params ?? {},
    body.model,
    body.effort,
  );
  return Response.json({ ok: true });
}

function cancelAgent(_req: Request, { acp }: Context): Response {
  acp.cancel();
  return Response.json({ ok: true });
}

// Detect accepted invites via 1st-degree LinkedIn search, then advance
// pending→accepted. Drives the MCP, so it can fail with a 502 if LinkedIn is
// unreachable.
async function syncRecruiters(req: Request, { broadcast }: Context): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    apply?: boolean;
  };
  try {
    const { runSync } = await import("../recruiter/sync.ts");
    const result = await runSync({ apply: body.apply === true });
    if (body.apply === true && result.changes.length) {
      db()
        .query(
          `INSERT INTO activity_log (kind, skill, summary)
             VALUES ('recruiter_sync', 'recruiter-sync', $summary)`,
        )
        .run({
          $summary: `Sync: ${result.changes.length} accepted (${result.changes
            .map((c) => c.name)
            .join(", ")})`,
        });
      broadcast({ type: "changed", table: "recruiters" });
      broadcast({ type: "changed", table: "activity_log" });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: errorMessage(err) },
      { status: 502 },
    );
  }
}

const postRoutes: Record<string, Route> = {
  "/api/browser/login": openBrowserLogin,
  "/api/acp/run": runAgent,
  "/api/acp/cancel": cancelAgent,
  "/api/recruiters/sync": syncRecruiters,
};

export async function routeApi(path: string, req: Request, context: Context): Promise<Response> {
  if (path === "/api/answer" || path.startsWith("/api/answer/") || path.startsWith("/api/answers/")) return handleAnswer(path, req, context.broadcast);
  if (path === "/api/interview-preps" || path.startsWith("/api/interview-preps/")) return handleInterviewPreps(path, req);
  if (path === "/api/followups" || path.startsWith("/api/followups/")) return handleFollowups(path, req, context.broadcast);
  if (path.startsWith("/api/onboarding/")) return handleOnboarding(path, req, context.broadcast);
  if (path === "/api/integrations" || path.startsWith("/api/integrations/")) return handleIntegrations(path, req, () => !!context.acp.isRunning || !!context.preparation?.isBusy || chromeLoginOpening(), context.broadcast);
  if (path === "/api/acp/permissions" || path.startsWith("/api/acp/permissions/")) return handlePermissions(path, req, context.acp.permissions);
  if (path.startsWith("/api/resume-sources") || path.startsWith("/api/application-preparation/")) {
    if (req.method === "POST" && integrationTesting()) return Response.json({ error: "Wait for the integration diagnostic to finish." }, { status: 409 });
    context.preparation ??= new PreparationService(context.acp, context.broadcast);
    return handlePreparation(path, req, context.preparation);
  }
  if (path === "/api/preparation-batches" || path.startsWith("/api/preparation-batches/")) {
    const preparation = context.preparation ??= new PreparationService(context.acp, context.broadcast);
    context.queue ??= new PreparationQueue(preparation, () => !!context.acp.isRunning || integrationTesting() || chromeLoginOpening(), context.broadcast, 0);
    return handleBatches(path, req, context.queue);
  }
  if (path.startsWith("/api/workspace-backup/")) {
    const busy = () => !!(context.acp.isRunning || context.preparation?.isBusy || integrationTesting() || chromeLoginOpening());
    return handleWorkspaceBackup(path, req, { busy, broadcast: context.broadcast });
  }
  if (path.startsWith("/api/jobs/")) {
    return handleJobAction(path, req, context.broadcast);
  }
  if (path === "/api/application-board" || path.startsWith("/api/application-board/")) {
    return handleApplicationBoard(path, req, context.broadcast);
  }
  // Search endpoints proxy requests to the LinkedIn MCP.
  if (path.startsWith("/api/search/")) {
    return handleSearch(path, req);
  }
  if (path === "/api/acp/providers") return listProviders();
  const route = req.method === "POST" && Object.hasOwn(postRoutes, path) ? postRoutes[path] : undefined;
  if (route) return route(req, context);
  return handleApi(path);
}

const readQueries: Record<string, () => unknown> = {
  "/api/overview": queries.overview,
  "/api/recruiters": queries.recruiters,
  "/api/recruiters/due": queries.recruitersDue,
  "/api/outreach": queries.outreach,
  "/api/jobs": queries.jobs,
  "/api/metrics": queries.metrics,
  "/api/interviews": queries.interviews,
  "/api/applications": queries.applications,
  "/api/applications/summary": queries.applicationSummary,
  "/api/answers": queries.answers,
  "/api/activity": queries.activity,
  "/api/profile": queries.profile,
  "/api/profile-snapshot": queries.profileSnapshot,
};

function handleApi(path: string): Response {
  if (!Object.hasOwn(readQueries, path)) return new Response("not found", { status: 404 });
  return Response.json(readQueries[path]());
}

async function handleSearch(path: string, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const { searchJobs, searchPeople, jobDetails } = await import(
      "../mcp/search.ts"
    );
    switch (path) {
      case "/api/search/jobs":
        return Response.json(
          await searchJobs({
            keywords: String(body.keywords ?? ""),
            location: body.location ? String(body.location) : undefined,
            workType: body.workType ? String(body.workType) : undefined,
            maxPages: body.maxPages ? Number(body.maxPages) : undefined,
          }),
        );
      case "/api/search/people":
        return Response.json(
          await searchPeople({
            keywords: String(body.keywords ?? ""),
            company: body.company ? String(body.company) : undefined,
            location: body.location ? String(body.location) : undefined,
          }),
        );
      case "/api/search/job-details":
        return Response.json(await jobDetails(String(body.jobId ?? "")));
      default:
        return new Response("not found", { status: 404 });
    }
  } catch (err) {
    return Response.json(
      { error: errorMessage(err) },
      { status: 502 },
    );
  }
}
