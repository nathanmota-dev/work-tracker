import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import type { Flags } from "../cli/flags.ts";
import { int } from "../cli/flags.ts";
import { ensureHome, paths } from "../paths.ts";
import { db, closeDb } from "../db/index.ts";
import { SessionManager } from "../acp/session.ts";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { closeMcp } from "../mcp/linkedin.ts";
import { stopAllOwned } from "../acp/process.ts";
import { PreparationService } from "../preparation/service.ts";
import { PreparationQueue } from "../preparation/batch-queue.ts";
import { integrationTesting } from "../integrations/http.ts";
import { chromeLoginOpening } from "../mcp/chrome.ts";
import { nodeRequestListener } from "./http-adapter.ts";
import { routeApi } from "./routes.ts";
import { permissionStore } from "../acp/permission-store.ts";

/** Internal HTTP boundary, shared by the server adapter and unit tests. */
export function createRequestHandler({
  token,
  acp,
  broadcast,
  preparation,
  queue,
}: {
  token: string;
  acp: Pick<SessionManager, "run" | "cancel"> & Partial<Pick<SessionManager, "isRunning" | "permissions">>;
  broadcast: (event: unknown) => void;
  preparation?: PreparationService;
  queue?: PreparationQueue;
}): (req: Request) => Promise<Response> {
  const context = { acp, broadcast, preparation, queue };
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
      return routeApi(path, req, context);
    }

    return new Response("not found", { status: 404 });
  };
}

export async function startBackend(flags: Flags = {}) {
  ensureHome();
  db(); // ensure schema
  permissionStore.recover();

  const port = int(flags, "port") ?? 0; // 0 = OS-assigned
  const token = randomUUID();
  const sockets = new Set<WebSocket>();
  const workspace = paths.workspace;
  // The batch queue follows runs and agent sessions to start its next item. Both
  // emit only after startup, once the queue below exists.
  const observe = (event: unknown) => queue.observe(event);
  const acp = new SessionManager(workspace, (event) => {
    broadcast(sockets, event);
    observe(event);
    if ((event as { type?: string }).type === "acp-permission" && !sockets.size) queueMicrotask(() => acp.disconnect());
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
  });
  const server = createServer(nodeRequestListener(handleRequest));
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
      ws.on("close", () => { sockets.delete(ws); if (!sockets.size) acp.disconnect(); });
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
