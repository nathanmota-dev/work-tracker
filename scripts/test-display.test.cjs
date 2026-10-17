"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { afterEach, describe, it } = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");

const helper = pathToFileURL(resolve(__dirname, "test-display.mjs")).href;
const homes = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "work tracker display "));
  homes.push(home);
  const env = { ...process.env, PATH: home, DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", WAYLAND_SOCKET: "7", XDG_SESSION_TYPE: "wayland", RECORD: join(home, "record.json") };
  delete env.WORK_TRACKER_XVFB_ACTIVE;
  delete env.WORK_TRACKER_TEST_DISPLAY;
  delete env.PWDEBUG;
  const executable = (name, source) => writeFileSync(join(home, name), `#!${process.execPath}\n${source}`, { mode: 0o700 });
  executable("Xvfb", "");
  executable("xauth", "");
  executable("xvfb-run", `
    const { spawnSync } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const args = process.argv.slice(2);
    writeFileSync(process.env.RECORD, JSON.stringify({ args, env: process.env }));
    const command = args.indexOf(${JSON.stringify(process.execPath)});
    const result = spawnSync(args[command], args.slice(command + 1), { env: { ...process.env, DISPLAY: ':123' }, stdio: 'inherit' });
    process.exit(result.status ?? 1);
  `);
  const entry = join(home, "entry with spaces.mjs");
  writeFileSync(entry, `
    import { ensureTestDisplay } from ${JSON.stringify(helper)};
    await ensureTestDisplay(process.argv.slice(2));
    console.log(JSON.stringify({ args: process.argv.slice(2), display: process.env.DISPLAY, active: process.env.WORK_TRACKER_XVFB_ACTIVE }));
    process.exitCode = Number(process.env.RESULT ?? 0);
  `);
  return { home, env, entry };
}

function execute(entry, env, args = []) {
  return spawnSync(process.execPath, [entry, ...args], { env, encoding: "utf8", timeout: 15000 });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for test process");
}

describe("virtual display entrypoints", () => {
  it("isolates an existing Wayland desktop, forwards exact arguments and preserves failure status", () => {
    const { env, entry } = fixture();
    const args = ["e2e/a file.spec.ts", "--grep", "a match with spaces", "literal $(text)"];
    const result = execute(entry, { ...env, RESULT: "7" }, args);
    assert.equal(result.status, 7, result.stderr);
    const record = JSON.parse(readFileSync(env.RECORD, "utf8"));
    assert.deepEqual(record.args.slice(0, 5), ["-a", "-e", "/dev/stderr", "-s", "-screen 0 1920x1080x24 -nolisten tcp"]);
    assert.equal(record.env.XDG_SESSION_TYPE, "x11");
    assert.equal(record.env.GDK_BACKEND, "x11");
    assert.equal(record.env.WAYLAND_DISPLAY, "");
    assert.equal(record.env.WAYLAND_SOCKET, undefined);
    assert.deepEqual(JSON.parse(result.stdout), { args, display: ":123", active: "1" });
    assert.equal(env.DISPLAY, ":0");
    assert.equal(env.WAYLAND_DISPLAY, "wayland-0");
  });

  it("runs without a desktop display and does not recursively start Xvfb", () => {
    const { env, entry } = fixture();
    delete env.DISPLAY;
    const result = execute(entry, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).display, ":123");
    const nested = execute(entry, { ...env, WORK_TRACKER_XVFB_ACTIVE: "1", DISPLAY: ":125" });
    assert.equal(nested.status, 0, nested.stderr);
    assert.equal(JSON.parse(nested.stdout).display, ":125");
  });

  it("allows visible execution and interactive debugging without Xvfb tools", () => {
    const { env, entry } = fixture();
    for (const [overrides, args] of [
      [{ WORK_TRACKER_TEST_DISPLAY: "host" }, []], [{}, ["--debug"]], [{}, ["--ui"]], [{ PWDEBUG: "1" }, []],
    ]) {
      const result = execute(entry, { ...env, PATH: "", ...overrides }, args);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).display, ":0");
    }
    assert.equal(existsSync(env.RECORD), false);
  });

  it("fails before launching when tools, managed DISPLAY or display mode are invalid", () => {
    const { env, entry } = fixture();
    for (const [overrides, message] of [
      [{ PATH: "" }, /Missing virtual display tools: Xvfb, xvfb-run, xauth/],
      [{ WORK_TRACKER_XVFB_ACTIVE: "1", DISPLAY: "" }, /missing DISPLAY/],
      [{ WORK_TRACKER_TEST_DISPLAY: "typo" }, /must be host or xvfb/],
    ]) {
      const result = execute(entry, { ...env, ...overrides });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, message);
      assert.equal(result.stdout, "");
    }
    assert.equal(existsSync(env.RECORD), false);
  });

  it("keeps native launch on non-Linux platforms and respects PWDEBUG=0", async () => {
    const { displayMode } = await import(helper);
    assert.equal(displayMode([], {}, "win32"), "host");
    assert.equal(displayMode([], {}, "darwin"), "host");
    assert.equal(displayMode([], { PWDEBUG: "0" }, "linux"), "xvfb");
  });

  it("keeps Vite options before the separator and Electron arguments after it", async () => {
    const { electronArgs } = await import(helper);
    const previous = process.env.WORK_TRACKER_XVFB_ACTIVE;
    const mode = process.env.WORK_TRACKER_TEST_DISPLAY;
    process.env.WORK_TRACKER_XVFB_ACTIVE = "1";
    delete process.env.WORK_TRACKER_TEST_DISPLAY;
    try {
      assert.deepEqual(electronArgs("electron-vite", ["dev", "--watch", "--", "--custom"], ["--remoteDebuggingPort=42"]),
        ["dev", "--watch", "--remoteDebuggingPort=42", "--", "--custom", "--ozone-platform=x11"]);
      assert.deepEqual(electronArgs("Work Tracker.AppImage", ["--no-sandbox"]), ["--no-sandbox", "--ozone-platform=x11"]);
    } finally {
      if (previous === undefined) delete process.env.WORK_TRACKER_XVFB_ACTIVE; else process.env.WORK_TRACKER_XVFB_ACTIVE = previous;
      if (mode === undefined) delete process.env.WORK_TRACKER_TEST_DISPLAY; else process.env.WORK_TRACKER_TEST_DISPLAY = mode;
    }
  });
});

describe("managed process cancellation", () => {
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    it(`forwards ${signal}, waits for cleanup and returns ${code}`, async () => {
      const { home, env } = fixture();
      const worker = join(home, "worker.mjs");
      const ready = join(home, "ready");
      const cleaned = join(home, "cleaned");
      writeFileSync(worker, `
        import { writeFileSync } from 'node:fs';
        import { onTermination } from ${JSON.stringify(helper)};
        import { setTimeout as delay } from 'node:timers/promises';
        onTermination(async () => { await delay(150); writeFileSync(${JSON.stringify(cleaned)}, 'done'); });
        writeFileSync(${JSON.stringify(ready)}, 'ready');
        setInterval(() => {}, 1000);
      `);
      const supervisor = join(home, "supervisor.mjs");
      writeFileSync(supervisor, `
        import { runCommand } from ${JSON.stringify(helper)};
        process.exitCode = await runCommand(process.execPath, [${JSON.stringify(worker)}]);
      `);
      const child = spawn(process.execPath, [supervisor], { env, stdio: "ignore" });
      const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
      try {
        await waitFor(() => existsSync(ready));
        child.kill(signal);
        assert.deepEqual(await exited, { code, signal: null });
        assert.equal(readFileSync(cleaned, "utf8"), "done");
      } finally { child.kill("SIGKILL"); }
    });
  }

  it("kills a process group that ignores termination after the grace period", async () => {
    const { home, env } = fixture();
    const ready = join(home, "ready");
    const worker = join(home, "stubborn.cjs");
    writeFileSync(worker, `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`);
    const child = spawn(process.execPath, [worker], { env, detached: true, stdio: "ignore" });
    const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    const { stopProcess } = await import(helper);
    try {
      await waitFor(() => existsSync(ready));
      await stopProcess(child, 100);
      assert.deepEqual(await exited, { code: null, signal: "SIGKILL" });
    } finally { await stopProcess(child, 0); }
  });
});
