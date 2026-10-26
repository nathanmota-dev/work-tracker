import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, type WriteStream } from "node:fs";
import { loadConfig } from "../paths.ts";
import { DEFAULT_IDLE_SECONDS, DEFAULT_PORT, RESTART_DELAY_MS, openBackendLog, openBrowser, runningAt, startCmd } from "./launcher.ts";
import { MAX_FAILURES } from "./supervisor.ts";
vi.mock("node:child_process", () => ({ fork: vi.fn(), spawn: vi.fn() }));
vi.mock("node:fs", () => ({ createWriteStream: vi.fn(), existsSync: vi.fn(), mkdirSync: vi.fn(), renameSync: vi.fn() }));
vi.mock("../paths.ts", () => ({ loadConfig: vi.fn(), paths: { home: "/private" } }));

type Child = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; send: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn>; connected: boolean };
let children: Child[], written: string[], signals: Map<string, () => void>;
const fetch = vi.fn<typeof globalThis.fetch>();
const child = () => children.at(-1)!;
const ready = () => child().emit("message", { type: "ready", address: "http://127.0.0.1:47830", token: "t" });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => {
  children = [];
  written = [];
  signals = new Map();
  vi.stubGlobal("fetch", fetch.mockReset().mockRejectedValue(new TypeError("fetch failed")));
  vi.mocked(loadConfig).mockReturnValue({});
  vi.mocked(existsSync).mockReturnValue(false);
  const stream = Object.assign(new EventEmitter(), { write: vi.fn((text: string | Buffer) => { written.push(String(text)); return true; }) });
  vi.mocked(createWriteStream).mockReturnValue(stream as unknown as WriteStream);
  vi.mocked(spawn).mockReset().mockReturnValue(Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as ChildProcess);
  vi.mocked(fork).mockReset().mockImplementation(() => {
    const next = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), send: vi.fn(), kill: vi.fn(), connected: true });
    children.push(next);
    return next as unknown as ChildProcess;
  });
  vi.spyOn(process, "once").mockImplementation(((event: string, listener: () => void) => { signals.set(event, listener); return process; }) as typeof process.once);
  vi.spyOn(process, "off").mockImplementation(((event: string) => { signals.delete(event); return process; }) as typeof process.off);
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { process.exitCode = undefined; });

test("a second start opens the running app; a foreign server on the port is reported", async () => {
  fetch.mockResolvedValueOnce(Response.json({ ok: true, version: "1.0.0" }));
  await startCmd({});
  expect(String(fetch.mock.calls[0]![0])).toBe(`http://127.0.0.1:${DEFAULT_PORT}/api/session`);
  expect(console.log).toHaveBeenCalledWith(`Work Tracker is already running at http://127.0.0.1:${DEFAULT_PORT}/`);
  expect(spawn).toHaveBeenCalledOnce();
  expect(fork).not.toHaveBeenCalled();
  fetch.mockResolvedValueOnce(new Response("<html>other app</html>"));
  await expect(runningAt("http://127.0.0.1:8080/", 8080)).rejects.toThrow("Port 8080 is used by another program. Start Work Tracker with --port");
  fetch.mockResolvedValueOnce(Response.json({ ok: true, version: "1.0.0" }, { status: 500 }));
  await expect(runningAt("http://127.0.0.1:8080/", 8080)).rejects.toThrow("used by another program");
});

test("runs the backend with its port, idle timeout and repository, then stops on a signal", async () => {
  vi.mocked(loadConfig).mockReturnValue({ port: 5000 });
  const done = startCmd({ "idle-timeout": "30", repo: "relative/repo" });
  await settle();
  expect(fork).toHaveBeenCalledWith(process.argv[1], ["__backend", "--port", "5000", "--idle-timeout", "30"], expect.objectContaining({ stdio: ["ignore", "pipe", "pipe", "ipc"] }));
  expect(vi.mocked(fork).mock.calls[0]![2]!.env!.WORK_TRACKER_REPO_ROOT).toMatch(/relative\/repo$/);
  child().stdout.emit("data", Buffer.from("backend output\n"));
  expect(written).toContain("backend output\n");
  ready();
  expect(console.log).toHaveBeenCalledWith(JSON.stringify({ type: "ready", address: "http://127.0.0.1:5000", port: 5000 }));
  expect(spawn).toHaveBeenCalledWith("xdg-open", ["http://127.0.0.1:5000/"], { detached: true, stdio: "ignore" });
  signals.get("SIGTERM")!();
  expect(child().send).toHaveBeenCalledWith({ type: "shutdown" });
  child().emit("message", { type: "stopped" });
  expect(child().send).toHaveBeenLastCalledWith({ type: "exit" });
  child().emit("exit", 0);
  await done;
  expect(console.log).toHaveBeenLastCalledWith('{"type":"stopped"}');
  expect(signals.size).toBe(0);
  expect(process.exitCode).toBeUndefined();
});

test("restarts a crashed backend on the same port without opening the browser again", async () => {
  vi.useFakeTimers();
  const done = startCmd({ "no-open": true });
  await settle();
  expect(vi.mocked(fork).mock.calls[0]![1]).toEqual(["__backend", "--port", String(DEFAULT_PORT), "--idle-timeout", String(DEFAULT_IDLE_SECONDS)]);
  ready();
  child().emit("exit", 9);
  expect(console.error).toHaveBeenCalledWith("The backend stopped unexpectedly (exit code 9).");
  await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS);
  expect(fork).toHaveBeenCalledTimes(2);
  ready();
  expect(spawn).not.toHaveBeenCalled();
  // The backend asks to stop after idleness; this is not a crash.
  child().emit("message", { type: "idle" });
  child().emit("message", { type: "stopped" });
  child().emit("exit", 0);
  await done;
  expect(fork).toHaveBeenCalledTimes(2);
});

test("gives up after repeated failures and points to the log", async () => {
  vi.useFakeTimers();
  const done = startCmd({ "no-open": true });
  await settle();
  for (let i = 0; i < MAX_FAILURES; i++) {
    child().emit("message", { type: "failed", message: "EADDRINUSE" });
    child().emit("exit", 1);
    await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS);
  }
  await done;
  expect(fork).toHaveBeenCalledTimes(MAX_FAILURES);
  expect(console.error).toHaveBeenCalledWith("The backend could not start: EADDRINUSE");
  expect(console.error).toHaveBeenLastCalledWith("Work Tracker stopped after repeated failures. See /private/logs/backend.log");
  expect(process.exitCode).toBe(1);
});

test("a signal between a crash and its restart ends without starting another backend", async () => {
  vi.useFakeTimers();
  const done = startCmd({ "no-open": true });
  await settle();
  ready();
  child().emit("exit", 9);
  signals.get("SIGINT")!();
  await done;
  await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS);
  expect(fork).toHaveBeenCalledOnce();
});

test("a backend that ignores the shutdown is killed", async () => {
  vi.useFakeTimers();
  void startCmd({ "no-open": true });
  await settle();
  ready();
  signals.get("SIGTERM")!();
  await vi.advanceTimersByTimeAsync(5000);
  expect(child().kill).toHaveBeenCalledWith("SIGKILL");
  child().connected = false;
  child().emit("exit", 1);
});

test("keeps the previous session's log and survives a log folder failure", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  expect(openBackendLog().path).toBe("/private/logs/backend.log");
  expect(mkdirSync).toHaveBeenCalledWith("/private/logs", { recursive: true, mode: 0o700 });
  expect(renameSync).toHaveBeenCalledWith("/private/logs/backend.log", "/private/logs/backend.log.previous");
  vi.mocked(mkdirSync).mockImplementationOnce(() => { throw new Error("read-only"); });
  const log = openBackendLog();
  expect(console.error).toHaveBeenCalledWith("Could not prepare the backend log:", expect.any(Error));
  vi.mocked(createWriteStream).mock.results.at(-1)!.value.emit("error", new Error("disk full"));
  expect(console.error).toHaveBeenLastCalledWith("Could not write the backend log:", expect.any(Error));
  log.write("line");
  expect(written).toContain("line");
});

test("opens the browser with each platform's command and ignores failures", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    for (const [name, command, args] of [["win32", "cmd", ["/c", "start", "", "http://x/"]], ["darwin", "open", ["http://x/"]]] as const) {
      Object.defineProperty(process, "platform", { value: name });
      openBrowser("http://x/");
      expect(spawn).toHaveBeenLastCalledWith(command, args, { detached: true, stdio: "ignore" });
    }
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
  vi.mocked(spawn).mockImplementationOnce(() => { throw new Error("ENOENT"); });
  expect(() => openBrowser("http://x/")).not.toThrow();
  const failing = vi.mocked(spawn).mock.results[0]!.value as EventEmitter;
  expect(() => failing.emit("error", new Error("ENOENT"))).not.toThrow();
});
