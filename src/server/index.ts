import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import type { Flags } from "../cli/flags.ts";
import { int } from "../cli/flags.ts";
import { ensureHome, paths } from "../paths.ts";
import { db, closeDb } from "../db/index.ts";
import { SessionManager } from "../acp/session.ts";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { closeMcp } from "../mcp/linkedin.ts";
import { stopAllOwned } from "../acp/process.ts";
import { PreparationService } from "../preparation/service.ts";
import { PreparationQueue } from "../preparation/batch-queue.ts";
import { integrationTesting } from "../integrations/http.ts";
import { chromeLoginOpening } from "../mcp/chrome.ts";
import { nodeRequestListener } from "./http-adapter.ts";
import { routeApi } from "./routes.ts";
import { permissionStore } from "../acp/permission-store.ts";
import { requestToken, sessionResponse, sessionToken, trustedOrigin } from "./session.ts";
import { serveStatic, webRoot } from "./static.ts";
import { VERSION } from "../version.gen.ts";
import { presence } from "./presence.ts";

/** Internal HTTP boundary, shared by the server adapter and unit tests. */
export function createRequestHandler({
  token,
  acp,
  broadcast,
  preparation,
  queue,
  port,
  web,
}: {
  token: string;
  acp: Pick<SessionManager, "run" | "cancel"> & Partial<Pick<SessionManager, "isRunning" | "permissions">>;
  broadcast: (event: unknown) => void;
  preparation?: PreparationService;
  queue?: PreparationQueue;
  /** Listening port; once known, other hosts and origins are rejected. */
  port?: () => number | undefined;
  /** Built web app served outside `/api/`. */
  web?: string;
}): (req: Request) => Promise<Response> {
  const context = { acp, broadcast, preparation, queue };
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!trustedOrigin({ host: req.headers.get("host"), origin: req.headers.get("origin") }, port?.()))
      return new Response("forbidden", { status: 403 });

    // --- Internal change hook (called by the CLI after a write) ---
    if (path === "/_internal/changed" && req.method === "POST") {
      if (req.headers.get("x-work-tracker-token") !== token) {
        return new Response("forbidden", { status: 403 });
      }
      const body = (await req.json().catch(() => ({}))) as { table?: string };
      broadcast({ type: "changed", table: body.table ?? "unknown" });
      return Response.json({ ok: true });
    }

    if (path === "/api/session" && req.method === "GET") return sessionResponse(req, token, VERSION);
    if (path.startsWith("/api/")) {
      if (requestToken(url, req.headers.get("cookie")) !== token) {
        return new Response("forbidden", { status: 403 });
      }
      return routeApi(path, req, context);
    }
    if (web && (req.method === "GET" || req.method === "HEAD")) return serveStatic(web, path);

    return new Response("not found", { status: 404 });
  };
}

/**
 * @param options.onIdle Called once no window has been open for `--idle-timeout`
 *   seconds and no agent, preparation, batch item, diagnostic or sign-in is active.
 * @param options.disconnectGraceMs Time without windows before a permission prompt is cancelled.
 */
export async function startBackend(flags: Flags = {}, options: { onIdle?: () => void; disconnectGraceMs?: number } = {}) {
  ensureHome();
  db(); // ensure schema
  permissionStore.recover();

  const port = int(flags, "port") ?? 0; // 0 = OS-assigned
  const idleMs = (int(flags, "idle-timeout") ?? 0) * 1000;
  const token = sessionToken();
  const windows = presence({
    idleMs,
    onIdle: options.onIdle,
    graceMs: options.disconnectGraceMs,
    busy: () => !!acp.isRunning || preparation.isBusy || queue.hasPending || integrationTesting() || chromeLoginOpening(),
    disconnect: () => acp.disconnect(),
  });
  const { sockets } = windows;
  const workspace = paths.workspace;
  // The batch queue follows runs and agent sessions to start its next item. Both
  // emit only after startup, once the queue below exists.
  const observe = (event: unknown) => queue.observe(event);
  const acp = new SessionManager(workspace, (event) => {
    broadcast(sockets, event);
    observe(event);
    if ((event as { type?: string }).type === "acp-permission") windows.permission();
  });

  const preparation = new PreparationService(acp, event => { broadcast(sockets, event); observe(event); });
  const queue = new PreparationQueue(preparation, () => acp.isRunning || integrationTesting() || chromeLoginOpening(), event => broadcast(sockets, event));
  queue.schedule();
  const handleRequest = createRequestHandler({
    token,
    acp,
    preparation,
    queue,
    broadcast: (event) => broadcast(sockets, event),
    port: () => listening(),
    web: webRoot(),
  });
  const server = createServer(nodeRequestListener(handleRequest));
  // Known once the server listens; requests only arrive after that.
  const listening = () => (server.address() as { port: number } | null)?.port;
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/ws" || requestToken(url, req.headers?.cookie) !== token ||
        !trustedOrigin({ host: req.headers?.host, origin: req.headers?.origin }, listening())) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      windows.open(ws);
      ws.on("error", () => ws.terminate());
      ws.on("close", () => windows.close(ws));
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
  windows.start();
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
        windows.stop();
        queue.close();
        await preparation.close();
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
          // The token is shared by every start; the pid identifies this backend's lock.
          if (JSON.parse(readFileSync(paths.serverLock, "utf8")).pid === process.pid)
            unlinkSync(paths.serverLock);
        } catch {
          /* absent */
        }
      })());
    },
  };
}
export async function dashboardCmd(flags: Flags): Promise<void> {
  const backend = await startBackend(flags, { onIdle: () => stop() });
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
