import { expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequestHandler } from "./index.ts";
import { SESSION_COOKIE } from "./session.ts";
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
const acp = { run: vi.fn(), cancel: vi.fn() };
const handle = createRequestHandler({ token: "secret", acp, broadcast: vi.fn(), port: () => 47830, web: "/app/web" });
const req = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(`http://127.0.0.1:47830${path}`, { method, headers: { host: "127.0.0.1:47830", ...headers } });

test("the web app gets a session cookie that authorizes the API", async () => {
  const session = await handle(req("/api/session", { "sec-fetch-site": "same-origin" }));
  expect(session.status).toBe(200);
  expect(session.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=secret`);
  expect((await handle(req("/api/missing"))).status).toBe(403);
  expect((await handle(req("/api/missing", { cookie: `${SESSION_COOKIE}=wrong` }))).status).toBe(403);
  // Authorized requests reach the router, which knows no such route.
  expect((await handle(req("/api/missing", { cookie: `${SESSION_COOKIE}=secret` }))).status).toBe(404);
  expect((await handle(req("/api/session", {}, "POST"))).status).toBe(403);
});

test("other sites and rebound host names are refused before anything runs", async () => {
  expect((await handle(req("/api/session", { host: "rebound.example:47830" }))).status).toBe(403);
  expect((await handle(req("/", { host: "rebound.example:47830" }))).status).toBe(403);
  const forged = req("/api/acp/run", { origin: "https://evil.example", cookie: `${SESSION_COOKIE}=secret` }, "POST");
  expect((await handle(forged)).status).toBe(403);
  expect(acp.run).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
});

test("serves the built app for reads only", async () => {
  vi.mocked(readFile).mockResolvedValue(Buffer.from("<html>") as never);
  const page = await handle(req("/"));
  expect(page.status).toBe(200);
  expect(await page.text()).toBe("<html>");
  expect(readFile).toHaveBeenCalledWith("/app/web/index.html");
  expect((await handle(req("/", {}, "POST"))).status).toBe(404);
  const bare = createRequestHandler({ token: "secret", acp, broadcast: vi.fn() });
  expect((await bare(req("/"))).status).toBe(404);
});
