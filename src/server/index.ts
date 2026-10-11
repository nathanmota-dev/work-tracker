import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import type { Flags } from "../cli/flags.ts";
import { int } from "../cli/flags.ts";
import { ensureHome, paths } from "../paths.ts";
import { db, now, closeDb } from "../db/index.ts";
import { queries } from "./queries.ts";
import { SessionManager } from "../acp/session.ts";
import { PROVIDERS, listProviderModels } from "../acp/providers.ts";
import { loadConfig } from "../paths.ts";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { closeMcp } from "../mcp/linkedin.ts";
import { stopAllOwned } from "../acp/process.ts";
import { chromeLoginOpening, openChromeLogin } from "../mcp/chrome.ts";
import { handleApplicationBoard } from "../applications/http.ts";

/** Internal HTTP boundary, shared by the server adapter and unit tests. */
export function createRequestHandler({
  token,
  acp,
  broadcast,
}: {
  token: string;
  acp: Pick<SessionManager, "run" | "cancel"> & Partial<Pick<SessionManager, "isRunning">>;
  broadcast: (event: unknown) => void;
}): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // --- Internal change hook (called by the CLI after a write) ---
    if (path === "/_internal/changed" && req.method === "POST") {
      if (req.headers.get("x-work-tracker-token") !== token) {
        return new Response("forbidden", { status: 403 });
      }
      const body = (await req.json().catch(() => ({}))) as { table?: string };
      broadcast({ type: "changed", table: body.table ?? "unknown" });
      return Response.json({ ok: true });
    }

    if (path.startsWith("/api/")) {
      if (url.searchParams.get("token") !== token) {
        return new Response("forbidden", { status: 403 });
      }
      if (path === "/api/application-board" || path.startsWith("/api/application-board/")) {
        return handleApplicationBoard(path, req, broadcast);
      }
      // Search endpoints proxy requests to the LinkedIn MCP.
      if (path.startsWith("/api/search/")) {
        return handleSearch(path, req);
      }
      if (path === "/api/browser/login" && req.method === "POST") {
        if (acp.isRunning) return Response.json({ error: "Finish or cancel the active agent run before opening browser sign-in." }, { status: 409 });
        try {
          await openChromeLogin();
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
        }
      }
      if (path === "/api/answer" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as {
          key?: string;
          value?: string;
          category?: string;
        };
        const key = (body.key ?? "").trim();
        if (!key)
          return Response.json({ error: "missing key" }, { status: 400 });
        db()
          .query(
            `INSERT INTO applicant_answers (key, value, category, updated_at)
               VALUES ($key, $value, $cat, $at)
               ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 category = COALESCE(excluded.category, applicant_answers.category),
                 updated_at = excluded.updated_at`,
          )
          .run({
            $key: key,
            $value: body.value ?? null,
            $cat: body.category ?? "custom",
            $at: now(),
          });
        // Notify all live dashboards (including this one) so tables refresh.
        broadcast({ type: "changed", table: "applicant_answers" });
        return Response.json({ ok: true });
      }
      if (path === "/api/acp/providers") {
        const cfg = loadConfig();
        const providerEntries = await Promise.all(
          Object.values(PROVIDERS).map(async (p) => ({
            id: p.id,
            displayName: p.displayName,
            models: await listProviderModels(p.id),
            defaultModel: p.defaultModel,
          })),
        );
        return Response.json({
          providers: providerEntries,
          default: cfg.provider ?? "opencode",
        });
      }
      if (path === "/api/acp/run" && req.method === "POST") {
        if (chromeLoginOpening()) return Response.json({ error: "Wait for the sign-in browser to open before starting your agent." }, { status: 409 });
        const body = (await req.json().catch(() => ({}))) as {
          provider?: string;
          skill?: string;
          params?: Record<string, string>;
          model?: string;
        };
        // Fire and forget — progress streams over the WebSocket.
        void acp.run(
          body.provider ?? "opencode",
          body.skill ?? "",
          body.params ?? {},
          body.model,
        );
        return Response.json({ ok: true });
      }
      if (path === "/api/acp/cancel" && req.method === "POST") {
        acp.cancel();
        return Response.json({ ok: true });
      }
      // Detect accepted invites via 1st-degree
      // LinkedIn search, then advance pending→accepted. Drives the MCP, so it
      // can fail with a 502 if LinkedIn is unreachable.
      if (path === "/api/recruiters/sync" && req.method === "POST") {
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
            { error: err instanceof Error ? err.message : String(err) },
            { status: 502 },
          );
        }
      }
      return handleApi(path);
    }

    return new Response("not found", { status: 404 });
  };
}

export async function startBackend(flags: Flags = {}) {
  ensureHome();
  db(); // ensure schema

  const port = int(flags, "port") ?? 0; // 0 = OS-assigned
  const token = randomUUID();
  const sockets = new Set<WebSocket>();
  const workspace = paths.workspace;
  const acp = new SessionManager(workspace, (event) =>
    broadcast(sockets, event),
  );

  const handleRequest = createRequestHandler({
    token,
    acp,
    broadcast: (event) => broadcast(sockets, event),
  });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          outgoing.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const method = incoming.method ?? "GET";
      const req = new Request(`http://127.0.0.1${incoming.url}`, {
        method,
        headers,
        ...(method !== "GET" && method !== "HEAD"
          ? { body: Buffer.concat(chunks) }
          : {}),
      });
      const response = await handleRequest(req);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing
        .writeHead(500, { "content-type": "application/json" })
        .end(JSON.stringify({ error: String(error) }));
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/ws" || url.searchParams.get("token") !== token) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("error", () => ws.terminate());
      ws.on("close", () => sockets.delete(ws));
      ws.send(JSON.stringify({ type: "hello" }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as { port: number };
  writeFileSync(
    paths.serverLock,
    JSON.stringify({ port: address.port, token, pid: process.pid }),
    { mode: 0o600 },
  );
  let closing: Promise<void> | undefined;
  return {
    port: address.port,
    token,
    address: `http://127.0.0.1:${address.port}`,
    close(): Promise<void> {
      return (closing ??= (async () => {
        acp.stop();
        for (const ws of sockets) ws.terminate();
        wss.close();
        const stopped = new Promise<void>((resolve) =>
          server.close(() => resolve()),
        );
        server.closeAllConnections();
        await Promise.all([stopped, closeMcp(), stopAllOwned()]);
        closeDb();
        try {
          if (
            JSON.parse(readFileSync(paths.serverLock, "utf8")).token === token
          )
            unlinkSync(paths.serverLock);
        } catch {
          /* absent */
        }
      })());
    },
  };
}
export async function dashboardCmd(flags: Flags): Promise<void> {
  const backend = await startBackend(flags);
  console.log(JSON.stringify({ type: "ready", ...backend }));
  const stop = () => {
    void backend.close().then(() => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
function broadcast(sockets: Set<WebSocket>, msg: unknown): void {
  const data = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

function handleApi(path: string): Response {
  switch (path) {
    case "/api/overview":
      return Response.json(queries.overview());
    case "/api/recruiters":
      return Response.json(queries.recruiters());
    case "/api/recruiters/due":
      return Response.json(queries.recruitersDue());
    case "/api/outreach":
      return Response.json(queries.outreach());
    case "/api/jobs":
      return Response.json(queries.jobs());
    case "/api/metrics":
      return Response.json(queries.metrics());
    case "/api/interviews":
      return Response.json(queries.interviews());
    case "/api/applications":
      return Response.json(queries.applications());
    case "/api/answers":
      return Response.json(queries.answers());
    case "/api/activity":
      return Response.json(queries.activity());
    case "/api/profile":
      return Response.json(queries.profile());
    case "/api/profile-snapshot":
      return Response.json(queries.profileSnapshot());
    default:
      return new Response("not found", { status: 404 });
  }
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
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
