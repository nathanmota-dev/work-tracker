import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { Database } from "../../db/sqlite.ts";
import { SCHEMA_VERSION } from "../../db/schema.ts";
const exec = promisify(execFile);
const previousEnv = { ...process.env };
const home = mkdtempSync(join(tmpdir(), "work tracker integration "));
process.env.WORK_TRACKER_HOME = home;
process.env.WORK_TRACKER_RESOURCES = resolve("resources");
process.env.WORK_TRACKER_CLI = resolve("out/cli/work-tracker.cjs");
const web = join(home, "web");
mkdirSync(join(web, "assets"), { recursive: true });
writeFileSync(join(web, "index.html"), "<!doctype html><title>Work Tracker</title>");
writeFileSync(join(web, "assets", "index-abc.js"), "console.log('app')");
process.env.WORK_TRACKER_WEB_ROOT = web;
let backend: Awaited<
  ReturnType<typeof import("../../server/index.ts").startBackend>
>;
let startBackend: typeof import("../../server/index.ts").startBackend;
let db: typeof import("../../db/index.ts").db;
let saveConfig: typeof import("../../paths.ts").saveConfig;
const cli = (...args: string[]) =>
  exec(process.execPath, [process.env.WORK_TRACKER_CLI!, ...args], {
    env: process.env,
  });
beforeAll(async () => {
  ({ startBackend } = await import("../../server/index.ts"));
  ({ db } = await import("../../db/index.ts"));
  ({ saveConfig } = await import("../../paths.ts"));
  backend = await startBackend();
});
afterAll(async () => {
  await backend?.close();
  rmSync(home, { recursive: true, force: true });
  process.env = previousEnv;
});
const api = (path: string, init?: RequestInit) =>
  fetch(`${backend.address}${path}?token=${backend.token}`, init);

test("fresh private database, WAL, foreign keys, initial schema and empty domain tables", () => {
  expect(existsSync(join(home, "work-tracker.db"))).toBe(true);
  expect(db().query("PRAGMA journal_mode").get()).toEqual({
    journal_mode: "wal",
  });
  expect(db().query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  for (const table of [
    "jobs",
    "recruiters",
    "applications",
    "outreach_attempts",
    "profile",
    "activity_log",
    "applicant_answers",
  ]) {
    expect(db().query(`SELECT count(*) as n FROM ${table}`).get()).toEqual({
      n: 0,
    });
  }
  expect(
    db().query("SELECT value FROM meta WHERE key='schema_version'").get(),
  ).toEqual({ value: String(SCHEMA_VERSION) });
  const columns = db().query("PRAGMA table_info(applications)").all() as {
    name: string;
  }[];
  expect(columns.map((c) => c.name)).toContain("external_url");
});
test("parameter binding and nested rollback preserve the outer transaction", () => {
  const d = new Database(":memory:");
  try {
    d.exec("CREATE TABLE items (value TEXT)");
    d.transaction(() => {
      d.query("INSERT INTO items VALUES ($value)").run({
        $value: "quote'; DROP TABLE items; --",
      });
      expect(() =>
        d.transaction(() => {
          d.query("INSERT INTO items VALUES (?)").run("discard");
          throw Error("rollback");
        })(),
      ).toThrow("rollback");
    })();
    expect(d.query("SELECT * FROM items").all()).toEqual([
      { value: "quote'; DROP TABLE items; --" },
    ]);
    expect(() =>
      d.transaction(() => {
        d.query("DELETE FROM items").run();
        throw Error("outer");
      })(),
    ).toThrow("outer");
    expect(d.query("SELECT count(*) as n FROM items").get()).toEqual({ n: 1 });
  } finally {
    d.close();
  }
});
test("HTTP and WebSocket require tokens; all query routes work without MCP executables", async () => {
  expect((await fetch(backend.address + "/api/jobs")).status).toBe(403);
  expect(
    (await fetch(backend.address + "/_internal/changed", { method: "POST" }))
      .status,
  ).toBe(403);
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(
      backend.address.replace("http:", "ws:") + "/ws?token=bad",
    );
    ws.on("unexpected-response", (_req, res) => {
      expect(res.statusCode).toBe(403);
      res.resume();
      ws.terminate();
      resolve();
    });
    ws.on("error", () => {});
    ws.on("open", () => {
      ws.close();
      reject(Error("unauthorized socket"));
    });
  });
  for (const route of [
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
  ])
    expect((await api("/api/" + route)).status).toBe(200);
  expect((await api("/api/update-status")).status).toBe(404);
  expect((await fetch(`${backend.address}/missing-page`)).status).toBe(404);
});
test("CLI writes notify the WebSocket and persist after restart", async () => {
  const ws = new WebSocket(
    backend.address.replace("http:", "ws:") + `/ws?token=${backend.token}`,
  );
  const events: unknown[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on("message", (data) => {
      events.push(JSON.parse(String(data)));
      resolve();
    });
    ws.on("error", reject);
  });
  await cli(
    "answer",
    "set",
    "--key",
    "email",
    "--value",
    "candidate@example.invalid",
  );
  await cli(
    "job",
    "save",
    "--linkedin-id",
    "synthetic-1",
    "--title",
    "Backend",
    "--company",
    "Acme Corp",
  );
  expect(events).toContainEqual({
    type: "changed",
    table: "applicant_answers",
  });
  const port = backend.port;
  await backend.close();
  expect(existsSync(join(home, "backend.lock"))).toBe(false);
  await expect(fetch(`http://127.0.0.1:${port}/api/jobs`)).rejects.toThrow();
  backend = await startBackend();
  expect(await (await api("/api/jobs")).json()).toMatchObject([
    { title: "Backend" },
  ]);
  expect(await (await api("/api/answers")).json()).toMatchObject([
    { key: "email", value: "candidate@example.invalid" },
  ]);
});
test("CLI operations, answer API and private skill setup", async () => {
  await cli(
    "recruiter",
    "add",
    "--name",
    "Recruiter Example",
    "--username",
    "recruiter-example-000001",
    "--company",
    "Acme Corp",
  );
  await cli("metric", "record", "--profile-views", "42");
  await cli("interview", "add", "--company", "Acme Corp", "--stage", "screen");
  await cli("application", "add", "--job-id", "1", "--portal", "greenhouse");
  await cli("outreach", "budget", "--plan", "none");
  await cli(
    "activity",
    "log",
    "--kind",
    "synthetic",
    "--summary",
    "Fixture action",
  );
  expect(
    (
      await api("/api/answer", {
        method: "POST",
        body: JSON.stringify({ key: "phone", value: "+1 202 555 0100" }),
      })
    ).status,
  ).toBe(200);
  expect(
    JSON.parse((await cli("match", "--labels", '["Email"]')).stdout).matched[0]
      .value,
  ).toBe("candidate@example.invalid");
  await cli("setup");
  expect(
    existsSync(
      join(
        home,
        "workspace",
        ".claude",
        "skills",
        "work-tracker-job-scout",
        "SKILL.md",
      ),
    ),
  ).toBe(true);
  const wrapper = join(home, "bin", "work-tracker");
  expect(
    (await exec(wrapper, ["--version"], { env: process.env })).stdout,
  ).toContain("work-tracker 1.0.0");
  expect(JSON.parse((await cli("doctor")).stdout).home).toBe(home);
});
test("missing MCP is lazy and surfaced when requested", async () => {
  saveConfig({
    mcp: { linkedin: { command: "work-tracker-missing-fixture" } },
  });
  const response = await api("/api/search/jobs", {
    method: "POST",
    body: JSON.stringify({ keywords: "fixture" }),
  });
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("work-tracker doctor");
  expect((await api("/api/jobs")).status).toBe(200);
  expect(
    JSON.parse(readFileSync(join(home, "backend.lock"), "utf8")).token,
  ).toBe(backend.token);
});

test("the browser app is served, opens a cookie session and refuses other origins", async () => {
  const page = await fetch(`${backend.address}/`);
  expect(page.headers.get("cache-control")).toBe("no-cache");
  expect(await page.text()).toContain("<title>Work Tracker</title>");
  expect((await fetch(`${backend.address}/assets/index-abc.js`)).headers.get("cache-control")).toContain("immutable");
  expect((await fetch(`${backend.address}/assets/missing.js`)).status).toBe(404);
  expect((await fetch(`${backend.address}/api/jobs`)).status).toBe(403);
  const session = await fetch(`${backend.address}/api/session`, { headers: { "sec-fetch-site": "same-origin" } });
  const cookie = session.headers.get("set-cookie")!.split(";")[0]!;
  expect(cookie).toBe(`wt_session=${backend.token}`);
  expect((await fetch(`${backend.address}/api/jobs`, { headers: { cookie } })).status).toBe(200);
  const forged = await fetch(`${backend.address}/api/answer`, { method: "POST", headers: { cookie, origin: "https://evil.example" }, body: "{}" });
  expect(forged.status).toBe(403);
  // A rebound DNS name reaches this port with its own Host header.
  const rebound = await new Promise<number>((done, fail) => {
    const req = httpRequest(`${backend.address}/`, { headers: { host: `rebound.example:${backend.port}` } }, (res) => { res.resume(); done(res.statusCode!); });
    req.on("error", fail);
    req.end();
  });
  expect(rebound).toBe(403);
  const socket = new WebSocket(`${backend.address.replace("http", "ws")}/ws`, { headers: { cookie, origin: "https://evil.example" } });
  await expect(new Promise((done, fail) => { socket.on("open", done); socket.on("error", fail); })).rejects.toThrow("403");
  const live = new WebSocket(`${backend.address.replace("http", "ws")}/ws`, { headers: { cookie, origin: backend.address } });
  expect(JSON.parse(String(await new Promise((done) => live.once("message", done))))).toEqual({ type: "hello" });
  live.close();
  // Every start keeps the same private token, so the installed app's cookie stays valid.
  expect(readFileSync(join(home, "session-token"), "utf8").trim()).toBe(backend.token);
  expect(statSync(join(home, "session-token")).mode & 0o777).toBe(0o600);
});
