import { afterAll, expect, test } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
const previousEnv = { ...process.env };
const home = mkdtempSync(join(tmpdir(), "work tracker protocols "));
process.env.WORK_TRACKER_HOME = home;
const fixture = resolve("src/test/fixtures/protocol-server.cjs");
const { saveConfig, ensureHome } = await import("../../paths.ts");
const { AcpClient } = await import("../../acp/client.ts");
const { SessionManager } = await import("../../acp/session.ts");
const { listTools, callTool, closeMcp } = await import("../../mcp/linkedin.ts");
const { stopAllOwned } = await import("../../acp/process.ts");
ensureHome();
afterAll(async () => {
  await closeMcp();
  await stopAllOwned();
  rmSync(home, { recursive: true, force: true });
  process.env = previousEnv;
});
const configure = (mode: string, extra: Record<string, string> = {}) =>
  saveConfig({
    acp: {
      opencode: {
        command: process.execPath,
        args: [fixture],
        env: { FIXTURE_MODE: mode, ...extra },
      },
    },
    mcp: {
      linkedin: {
        command: process.execPath,
        args: [fixture],
        env: { FIXTURE_MODE: mode, ...extra },
      },
    },
  });

test("MCP connects once, lists tools, parses results and propagates tool errors", async () => {
  configure("normal");
  try {
    expect(await listTools()).toEqual(["echo"]);
    expect(await callTool("echo", { synthetic: true })).toEqual({
      synthetic: true,
    });
    await expect(callTool("fail", { error: "fixture" })).rejects.toThrow(
      "fixture",
    );
  } finally {
    await closeMcp();
  }
});
test("MCP process failure can reconnect using corrected configuration", async () => {
  configure("exit");
  await expect(listTools()).rejects.toThrow("unavailable");
  configure("normal");
  expect(await listTools()).toEqual(["echo"]);
  await closeMcp();
});
test("ACP passes explicit workspace, MCP desktop environment and CLI PATH and streams updates", async () => {
  const record = join(home, "session.json");
  configure("normal", { FIXTURE_RECORD: record });
  const updates: unknown[] = [];
  const client = new AcpClient("opencode", home, {
    onUpdate: (u) => updates.push(u),
  });
  try {
    await client.start();
    expect(await client.prompt("synthetic prompt")).toEqual({
      stopReason: "end_turn",
    });
    expect(updates).toHaveLength(1);
    const result = JSON.parse(readFileSync(record, "utf8"));
    expect(result.params.cwd).toBe(home);
    expect(result.params.mcpServers).toHaveLength(2);
    expect(result.params.mcpServers[0].args).toEqual([fixture]);
    expect(result.params.mcpServers[0].env).toContainEqual({ name: "XDG_CONFIG_HOME", value: process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config") });
    expect(result.path.startsWith(join(home, "bin"))).toBe(true);
    expect(result.home).toBe(home);
  } finally {
    client.stop();
  }
});
test("ACP handles missing executable, unexpected exit and invalid session", async () => {
  saveConfig({
    acp: { opencode: { command: "work-tracker-missing-fixture" } },
  });
  let client = new AcpClient("opencode", home);
  try {
    await expect(client.start()).rejects.toThrow("executable");
  } finally {
    client.stop();
  }
  for (const mode of ["exit", "invalid"]) {
    configure(mode);
    client = new AcpClient("opencode", home);
    try {
      await expect(client.start()).rejects.toThrow();
    } finally {
      client.stop();
    }
  }
});
test("ACP timeout rejects the handshake and kills its process", async () => {
  configure("hang");
  const client = new AcpClient("opencode", home, {}, undefined, 80);
  try {
    await expect(client.start()).rejects.toThrow("timeout");
  } finally {
    client.stop();
  }
});
test("ACP cancellation settles pending prompts", async () => {
  configure("cancel");
  let streamed!: () => void;
  const update = new Promise<void>((resolve) => {
    streamed = resolve;
  });
  const client = new AcpClient("opencode", home, {
    onUpdate: () => streamed(),
  });
  try {
    await client.start();
    const outcome = client.prompt("wait").catch((e) => e.message);
    await update;
    await client.cancel();
    client.stop();
    expect(await outcome).toContain("stopped");
  } finally {
    client.stop();
  }
});
test("owned descendants are terminated on shutdown", async () => {
  const pidFile = join(home, "child.pid");
  configure("tree", { FIXTURE_PID: pidFile });
  const client = new AcpClient("opencode", home);
  await client.start();
  const pid = Number(readFileSync(pidFile, "utf8"));
  client.stop();
  await stopAllOwned();
  // A dead child can briefly remain as a zombie until the host reaps it.
  let alive = false;
  try {
    alive = !readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z ");
  } catch {
    /* reaped */
  }
  expect(alive).toBe(false);
});
test("sign-in survives the end of an ACP turn and retry uses the same live process and browser", async () => {
  const pidFile = join(home, "auth-child.pid"), starts = join(home, "auth-starts.jsonl");
  configure("auth-retry", { FIXTURE_PID: pidFile, FIXTURE_START_LOG: starts });
  const events: Array<{ type?: string; status?: string }> = [];
  const manager = new SessionManager(home, event => events.push(event as { type?: string; status?: string }));
  try {
    await manager.run("opencode", "profile-optimizer", {});
    const browserPid = Number(readFileSync(pidFile, "utf8"));
    expect(events.at(-1)?.status).toBe("waiting_for_sign_in");
    expect(manager.isRunning).toBe(false);
    expect(process.kill(browserPid, 0)).toBe(true);
    await manager.run("opencode", "profile-optimizer", {});
    expect(events.at(-1)?.status).toBe("done");
    expect(readFileSync(starts, "utf8").trim().split("\n")).toHaveLength(1);
    await stopAllOwned();
    let alive = false;
    try { alive = !readFileSync(`/proc/${browserPid}/stat`, "utf8").includes(") Z "); } catch { /* reaped */ }
    expect(alive).toBe(false);
  } finally { manager.stop(); }
});
