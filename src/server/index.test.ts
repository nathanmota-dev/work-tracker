import { beforeEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequestHandler, startBackend, dashboardCmd } from "./index.ts";
import { startProfileWatch, stopProfileWatch } from "../profile/watch.ts";
import { ensureMcpServers, onInstallChange } from "../mcp/install/index.ts";
import { queries } from "./queries.ts";
import { SessionManager } from "../acp/session.ts";
import { listProviderModels } from "../acp/providers.ts";
import { loadConfig } from "../paths.ts";
import { db, closeDb } from "../db/index.ts";
import { closeMcp } from "../mcp/linkedin.ts";
import { stopAllOwned } from "../acp/process.ts";
import { searchJobs, searchPeople, jobDetails } from "../mcp/search.ts";
import { runSync } from "../recruiter/sync.ts";
import { databaseDouble } from "../test/doubles.ts";
import { chromeLoginOpening, openChromeLogin } from "../mcp/chrome.ts";
vi.mock("../mcp/chrome.ts", () => ({ chromeLoginOpening: vi.fn(() => false), openChromeLogin: vi.fn() }));
vi.mock("./queries.ts", () => ({
  queries: Object.fromEntries(
    [
      "overview",
      "recruiters",
      "recruitersDue",
      "outreach",
      "jobs",
      "metrics",
      "interviews",
      "applications",
      "answers",
      "activity",
      "profile",
      "profileSnapshot",
    ].map((name) => [name, vi.fn(() => ({ result: name }))]),
  ),
}));
vi.mock("../acp/session.ts", () => ({ SessionManager: vi.fn() }));
vi.mock("../acp/providers.ts", () => ({
  PROVIDERS: {
    opencode: { id: "opencode", displayName: "opencode", efforts: [] },
    "claude-code": { id: "claude-code", displayName: "Claude Code", efforts: ["low", "high"] },
  },
  listProviderModels: vi.fn(),
}));
vi.mock("../paths.ts", () => ({
  ensureHome: vi.fn(),
  loadConfig: vi.fn(),
  paths: { workspace: "/private", serverLock: "/private/backend.lock" },
}));
vi.mock("../db/index.ts", () => ({
  db: vi.fn(),
  closeDb: vi.fn(),
  now: () => "2026-10-10T12:00:00Z",
}));
vi.mock("../mcp/linkedin.ts", () => ({
  closeMcp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../acp/process.ts", () => ({
  stopAllOwned: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../mcp/search.ts", () => ({
  searchJobs: vi.fn(),
  searchPeople: vi.fn(),
  jobDetails: vi.fn(),
}));
vi.mock("../recruiter/sync.ts", () => ({ runSync: vi.fn() }));
vi.mock("../profile/watch.ts", () => ({ startProfileWatch: vi.fn(), stopProfileWatch: vi.fn(), syncProfileWatch: vi.fn(), importPending: vi.fn(), profileImporting: vi.fn(() => false) }));
vi.mock("../mcp/install/index.ts", () => ({ ensureMcpServers: vi.fn(async () => []), onInstallChange: vi.fn(), installStates: vi.fn(() => []) }));
vi.mock("ws", () => ({ WebSocket: { OPEN: 1 }, WebSocketServer: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
let acp: {
    run: ReturnType<typeof vi.fn<SessionManager["run"]>>;
    cancel: ReturnType<typeof vi.fn<SessionManager["cancel"]>>;
    stop: ReturnType<typeof vi.fn<SessionManager["stop"]>>;
    disconnect: ReturnType<typeof vi.fn<SessionManager["disconnect"]>>;
  },
  broadcast: ReturnType<typeof vi.fn<(event: unknown) => void>>,
  handle: ReturnType<typeof createRequestHandler>;
const req = (path: string, body?: unknown, token = "secret") =>
  new Request(
    `http://localhost${path}${token ? `?token=${token}` : ""}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          body: typeof body === "string" ? body : JSON.stringify(body),
        },
  );
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  vi.mocked(loadConfig).mockReturnValue({});
  acp = {
    run: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  broadcast = vi.fn();
  handle = createRequestHandler({ token: "secret", acp, broadcast });
  vi.mocked(chromeLoginOpening).mockReturnValue(false);
  vi.mocked(openChromeLogin).mockReset().mockResolvedValue(undefined);
  vi.mocked(searchJobs).mockReset();
  vi.mocked(searchPeople).mockReset();
  vi.mocked(jobDetails).mockReset();
  vi.mocked(runSync).mockReset();
});
test("browser sign-in requires authentication, reports startup failures and avoids active sessions", async () => {
  expect((await handle(req("/api/browser/login", {}, ""))).status).toBe(403);
  expect(openChromeLogin).not.toHaveBeenCalled();
  expect((await handle(req("/api/browser/login", {}))).status).toBe(200);
  expect(openChromeLogin).toHaveBeenCalledOnce();
  vi.mocked(openChromeLogin).mockRejectedValueOnce(new Error("Chrome missing"));
  const failed = await handle(req("/api/browser/login", {}));
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "Chrome missing" });
  const running = createRequestHandler({ token: "secret", acp: { ...acp, isRunning: true }, broadcast });
  expect((await running(req("/api/browser/login", {}))).status).toBe(409);
  expect(openChromeLogin).toHaveBeenCalledTimes(2);
  vi.mocked(chromeLoginOpening).mockReturnValue(true);
  expect((await handle(req("/api/acp/run", {}))).status).toBe(409);
  expect(acp.run).not.toHaveBeenCalled();
});
test("authentication precedes dispatch; unknown routes are 404", async () => {
  expect((await handle(req("/api/jobs", undefined, ""))).status).toBe(403);
  expect((await handle(req("/api/jobs", undefined, "bad"))).status).toBe(403);
  expect(queries.jobs).not.toHaveBeenCalled();
  expect((await handle(req("/api/missing"))).status).toBe(404);
  expect((await handle(req("/"))).status).toBe(404);
  expect(
    (
      await handle(
        new Request("http://localhost/_internal/changed", { method: "POST" }),
      )
    ).status,
  ).toBe(403);
});
test.each([
  "overview",
  "recruiters",
  "recruiters/due",
  "outreach",
  "jobs",
  "metrics",
  "interviews",
  "applications",
  "answers",
  "activity",
  "profile",
  "profile-snapshot",
])("dispatches /api/%s to its query", async (path) => {
  const name =
    path === "recruiters/due"
      ? "recruitersDue"
      : path === "profile-snapshot"
        ? "profileSnapshot"
        : path;
  expect(await (await handle(req(`/api/${path}`))).json()).toEqual({
    result: name,
  });
});
test("internal change hook broadcasts provided tables or unknown on malformed JSON", async () => {
  for (const body of ['{"table":"jobs"}', "bad-json"]) {
    const response = await handle(
      new Request("http://localhost/_internal/changed", {
        method: "POST",
        headers: { "x-work-tracker-token": "secret" },
        body,
      }),
    );
    expect(await response.json()).toEqual({ ok: true });
  }
  expect(broadcast.mock.calls).toEqual([
    [{ type: "changed", table: "jobs" }],
    [{ type: "changed", table: "unknown" }],
  ]);
});
test("answer writes validate a trimmed key and persist defaults before notifying", async () => {
  for (const body of ["bad-json", {}, { key: "  " }])
    expect((await handle(req("/api/answer", body))).status).toBe(400);
  expect(d.statement.run).not.toHaveBeenCalled();
  expect(
    await (await handle(req("/api/answer", { key: " email " }))).json(),
  ).toEqual({ ok: true });
  expect(d.statement.run).toHaveBeenLastCalledWith({
    $key: "email",
    $value: null,
    $cat: "contact",
    $at: "2026-10-10T12:00:00Z",
    $default: 1,
  });
  await handle(
    req("/api/answer", {
      key: "email",
      value: "fixture@example.invalid",
      category: "contact",
    }),
  );
  expect(d.statement.run).toHaveBeenLastCalledWith(
    expect.objectContaining({
      $value: "fixture@example.invalid",
      $cat: "contact",
    }),
  );
  expect(broadcast).toHaveBeenCalledWith({
    type: "changed",
    table: "applicant_answers",
  });
});
test("ACP routes list models and efforts, default the provider and dispatch selected params/model/effort and cancellation", async () => {
  vi.mocked(listProviderModels).mockResolvedValue(["fixture/model"]);
  expect(await (await handle(req("/api/acp/providers"))).json()).toEqual({
    providers: [
      { id: "opencode", displayName: "opencode", models: ["fixture/model"], efforts: [] },
      { id: "claude-code", displayName: "Claude Code", models: ["fixture/model"], efforts: ["low", "high"] },
    ],
    default: "opencode",
  });
  vi.mocked(loadConfig).mockReturnValue({ provider: "claude-code" });
  expect(
    (
      (await (await handle(req("/api/acp/providers"))).json()) as {
        default: string;
      }
    ).default,
  ).toBe("claude-code");
  await handle(req("/api/acp/run", "bad-json"));
  expect(acp.run).toHaveBeenLastCalledWith("opencode", "", {}, undefined, undefined);
  await handle(
    req("/api/acp/run", {
      provider: "claude-code",
      skill: "job-scout",
      params: { query: "TS" },
      model: "sonnet",
      effort: "high",
    }),
  );
  expect(acp.run).toHaveBeenLastCalledWith(
    "claude-code",
    "job-scout",
    { query: "TS" },
    "sonnet",
    "high",
  );
  acp.run.mockClear();
  for (const body of [{ provider: "claude-code", effort: "max" }, { effort: "low" }]) {
    const response = await handle(req("/api/acp/run", body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Unsupported effort") });
  }
  expect(acp.run).not.toHaveBeenCalled();
  await handle(req("/api/acp/cancel", {}));
  expect(acp.cancel).toHaveBeenCalledOnce();
});
test("search routes map optional arguments, default malformed JSON, and surface MCP errors", async () => {
  vi.mocked(searchJobs).mockResolvedValue({ jobs: [] });
  vi.mocked(searchPeople).mockResolvedValue({ people: [] });
  vi.mocked(jobDetails).mockResolvedValue({ id: "one" });
  expect(
    await (
      await handle(
        req("/api/search/jobs", {
          keywords: "TS",
          location: "Brazil",
          workType: "remote",
          maxPages: "2",
        }),
      )
    ).json(),
  ).toEqual({ jobs: [] });
  expect(searchJobs).toHaveBeenCalledWith({
    keywords: "TS",
    location: "Brazil",
    workType: "remote",
    maxPages: 2,
  });
  await handle(req("/api/search/jobs", "bad-json"));
  expect(searchJobs).toHaveBeenLastCalledWith({
    keywords: "",
    location: undefined,
    workType: undefined,
    maxPages: undefined,
  });
  await handle(
    req("/api/search/people", {
      keywords: "recruiter",
      company: "Acme",
      location: "Brazil",
    }),
  );
  expect(searchPeople).toHaveBeenCalledWith({
    keywords: "recruiter",
    company: "Acme",
    location: "Brazil",
  });
  await handle(req("/api/search/job-details", { jobId: 1 }));
  expect(jobDetails).toHaveBeenCalledWith("1");
  expect((await handle(req("/api/search/missing", {}))).status).toBe(404);
  vi.mocked(searchJobs).mockRejectedValue(new Error("offline"));
  const failure = await handle(req("/api/search/jobs", {}));
  expect(failure.status).toBe(502);
  expect(await failure.json()).toEqual({ error: "offline" });
});
test("sync defaults to dry-run and only logs/notifies applied nonempty changes", async () => {
  const result = {
    changes: [
      {
        id: 1,
        name: "One",
        company: "Acme",
        from: "pending",
        to: "accepted",
        matchedBy: "username" as const,
      },
    ],
    scanned: 1,
    applied: false,
    skipped: [],
    companiesQueried: 1,
  };
  vi.mocked(runSync).mockResolvedValue(
    result as Awaited<ReturnType<typeof runSync>>,
  );
  await handle(req("/api/recruiters/sync", {}));
  expect(runSync).toHaveBeenLastCalledWith({ apply: false });
  expect(broadcast).not.toHaveBeenCalled();
  await handle(req("/api/recruiters/sync", { apply: true }));
  expect(runSync).toHaveBeenLastCalledWith({ apply: true });
  expect(d.statement.run).toHaveBeenCalledWith({
    $summary: "Sync: 1 accepted (One)",
  });
  expect(broadcast.mock.calls).toEqual([
    [{ type: "changed", table: "recruiters" }],
    [{ type: "changed", table: "activity_log" }],
  ]);
  broadcast.mockClear();
  vi.mocked(runSync).mockResolvedValue({ ...result, changes: [] });
  await handle(req("/api/recruiters/sync", { apply: true }));
  expect(broadcast).not.toHaveBeenCalled();
  vi.mocked(runSync).mockRejectedValue("unavailable");
  const failure = await handle(req("/api/recruiters/sync", {}));
  expect(failure.status).toBe(502);
  expect(await failure.json()).toEqual({ error: "unavailable" });
});
function serverDouble() {
  return Object.assign(new EventEmitter(), {
    listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
    address: () => ({ port: 1234 }),
    close: vi.fn((cb: () => void) => cb()),
    closeAllConnections: vi.fn(),
  });
}
test("backend authenticates upgrades, broadcasts to open sockets and closes every resource once", async () => {
  const server = serverDouble(),
    wss = { handleUpgrade: vi.fn(), close: vi.fn() };
  vi.mocked(createServer).mockReturnValue(server as unknown as Server);
  vi.mocked(WebSocketServer).mockImplementation(function () {
    return wss as unknown as WebSocketServer;
  });
  let sink!: (event: unknown) => void;
  vi.mocked(SessionManager).mockImplementation(function (_cwd, callback) {
    sink = callback;
    return acp as unknown as SessionManager;
  });
  vi.mocked(writeFileSync).mockReturnValue(undefined);
  vi.mocked(unlinkSync).mockReturnValue(undefined);
  const backend = await startBackend({ port: "3333" });
  sink({ type: "acp-permission" });
  await Promise.resolve();
  expect(acp.disconnect).toHaveBeenCalledOnce();
  expect(server.listen).toHaveBeenCalledWith(
    3333,
    "127.0.0.1",
    expect.any(Function),
  );
  expect(writeFileSync).toHaveBeenCalledWith(
    "/private/backend.lock",
    JSON.stringify({ port: 1234, token: backend.token, pid: process.pid }),
    { mode: 0o600 },
  );
  const socket = { end: vi.fn() };
  server.emit("upgrade", { url: "/ws?token=bad" }, socket, Buffer.alloc(0));
  expect(socket.end).toHaveBeenCalledWith(expect.stringContaining("403"));
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    terminate: vi.fn(),
  });
  wss.handleUpgrade.mockImplementation((_req, _socket, _head, cb) => cb(ws));
  server.emit(
    "upgrade",
    { url: `/ws?token=${backend.token}` },
    socket,
    Buffer.alloc(0),
  );
  expect(ws.send).toHaveBeenCalledWith('{"type":"hello"}');
  sink({ type: "changed" });
  expect(ws.send).toHaveBeenLastCalledWith('{"type":"changed"}');
  ws.readyState = 3;
  sink({ type: "ignored" });
  expect(ws.send).toHaveBeenCalledTimes(2);
  ws.emit("error", new Error("gone"));
  ws.emit("close");
  expect(acp.disconnect).toHaveBeenCalledTimes(2);
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({ token: backend.token }),
  );
  const closing = backend.close();
  expect(backend.close()).toBe(closing);
  await closing;
  expect(acp.stop).toHaveBeenCalledOnce();
  expect(wss.close).toHaveBeenCalledOnce();
  expect(server.closeAllConnections).toHaveBeenCalledOnce();
  expect(closeMcp).toHaveBeenCalledOnce();
  expect(stopAllOwned).toHaveBeenCalledOnce();
  expect(closeDb).toHaveBeenCalledOnce();
  expect(unlinkSync).toHaveBeenCalledWith("/private/backend.lock");
  // Background work started with the backend: profile imports and the MCP installation.
  expect(ensureMcpServers).toHaveBeenCalledOnce();
  expect(stopProfileWatch).toHaveBeenCalledOnce();
  // Both announce their changes to the connected windows; none are left after shutdown.
  vi.mocked(onInstallChange).mock.calls[0]![0]();
  vi.mocked(startProfileWatch).mock.calls[0]![0]();
  expect(ws.send).toHaveBeenCalledTimes(2);
});
test("HTTP adapter converts responses, rejects large bodies and handles exceptions; shutdown preserves another backend's lock", async () => {
  const server = serverDouble(),
    wss = { close: vi.fn() };
  vi.mocked(createServer).mockReturnValue(server as unknown as Server);
  vi.mocked(WebSocketServer).mockImplementation(function () {
    return wss as unknown as WebSocketServer;
  });
  vi.mocked(SessionManager).mockImplementation(function () {
    return acp as unknown as SessionManager;
  });
  vi.mocked(writeFileSync).mockReturnValue(undefined);
  const backend = await startBackend();
  const callback = vi.mocked(createServer).mock.calls[0][0] as unknown as (
    incoming: unknown,
    outgoing: unknown,
  ) => Promise<void>;
  const outgoing = { writeHead: vi.fn(), end: vi.fn() };
  outgoing.writeHead.mockReturnValue(outgoing);
  const incoming = (url: string, chunks: Buffer[] = [], headers = {}) => ({
    method: "POST",
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  });
  await callback(
    incoming(`/_internal/changed`, [Buffer.from('{"table":"jobs"}')], {
      "x-work-tracker-token": backend.token,
      "x-list": ["a", "b"],
    }),
    outgoing,
  );
  expect(outgoing.writeHead).toHaveBeenLastCalledWith(200, expect.any(Object));
  expect(outgoing.end).toHaveBeenLastCalledWith(Buffer.from('{"ok":true}'));
  await callback(incoming("/", [Buffer.alloc(1024 * 1024 + 1)]), outgoing);
  expect(outgoing.writeHead).toHaveBeenLastCalledWith(413);
  vi.mocked(queries.jobs).mockImplementationOnce(() => {
    throw new Error("db failed");
  });
  await callback(
    { ...incoming(`/api/jobs?token=${backend.token}`), method: "GET" },
    outgoing,
  );
  expect(outgoing.writeHead).toHaveBeenLastCalledWith(500, {
    "content-type": "application/json",
  });
  expect(outgoing.end).toHaveBeenLastCalledWith(
    expect.stringContaining("db failed"),
  );
  vi.mocked(readFileSync).mockReturnValue('{"token":"another-backend"}');
  await backend.close();
  expect(unlinkSync).not.toHaveBeenCalled();
});

test("listen failure propagates before lock publication", async () => {
  const server = serverDouble();
  server.listen.mockImplementation(() => {
    server.emit("error", new Error("EADDRINUSE"));
  });
  vi.mocked(createServer).mockReturnValue(server as unknown as Server);
  vi.mocked(WebSocketServer).mockImplementation(function () {
    return {} as WebSocketServer;
  });
  vi.mocked(SessionManager).mockImplementation(function () {
    return acp as unknown as SessionManager;
  });
  await expect(startBackend()).rejects.toThrow("EADDRINUSE");
  expect(writeFileSync).not.toHaveBeenCalled();
});
test("CLI backend publishes readiness and removes both signal handlers after shutdown", async () => {
  const server = serverDouble();
  vi.mocked(createServer).mockReturnValue(server as unknown as Server);
  vi.mocked(WebSocketServer).mockImplementation(function () {
    return { close: vi.fn() } as unknown as WebSocketServer;
  });
  vi.mocked(SessionManager).mockImplementation(function () {
    return acp as unknown as SessionManager;
  });
  vi.mocked(writeFileSync).mockReturnValue(undefined);
  vi.mocked(readFileSync).mockReturnValue("bad-lock");
  const log = vi.spyOn(console, "log").mockImplementation(() => {}),
    once = vi.spyOn(process, "once").mockReturnValue(process),
    off = vi.spyOn(process, "off").mockReturnValue(process);
  await dashboardCmd({});
  expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
    type: "ready",
    port: 1234,
    address: "http://127.0.0.1:1234",
  });
  const stop = once.mock.calls.find(
    ([signal]) => signal === "SIGTERM",
  )![1] as () => void;
  stop();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(off).toHaveBeenCalledWith("SIGINT", stop);
  expect(off).toHaveBeenCalledWith("SIGTERM", stop);
  expect(closeDb).toHaveBeenCalledOnce();
});
