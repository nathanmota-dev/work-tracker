import { fork, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Flags } from "../cli/flags.ts";
import { int, str } from "../cli/flags.ts";
import { loadConfig, paths } from "../paths.ts";
import { BackendSupervisor, type BackendHandlers } from "./supervisor.ts";

export const DEFAULT_PORT = 47830;
export const DEFAULT_IDLE_SECONDS = 600;
/** Pause before an automatic restart, so the stopped process releases its port. */
export const RESTART_DELAY_MS = 500;
const SHUTDOWN_TIMEOUT_MS = 5000;

/** Backend output of this session, kept next to the previous session's log. */
export function openBackendLog() {
  const path = join(paths.home, "logs", "backend.log");
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path)) renameSync(path, `${path}.previous`);
  } catch (error) {
    console.error("Could not prepare the backend log:", error);
  }
  const stream = createWriteStream(path, { flags: "a", mode: 0o600 });
  stream.on("error", (error) => console.error("Could not write the backend log:", error));
  return { path, write: (text: string | Buffer) => stream.write(text) };
}

/** Opens the app in the default browser; failures only leave the printed address. */
export function openBrowser(url: string): void {
  const [command, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch { /* the address is printed */ }
}

/** Whether Work Tracker already answers at `url`; throws when another program owns the port. */
export async function runningAt(url: string, port: number): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(new URL("/api/session", url), { signal: AbortSignal.timeout(2000) });
  } catch {
    return false;
  }
  const body = (await response.json().catch(() => undefined)) as { ok?: boolean; version?: string } | undefined;
  if (response.ok && body?.ok === true && body.version) return true;
  throw new Error(`Port ${port} is used by another program. Start Work Tracker with --port <number>; the installed app must then be installed again from the new address.`);
}

/**
 * `work-tracker start`: runs the backend in a supervised process, restarts it
 * after a crash (up to `MAX_FAILURES`) on the same port, opens the browser and
 * ends when the backend stops after idleness, a signal or repeated failures.
 * A second start only opens the running app.
 */
export async function startCmd(flags: Flags): Promise<void> {
  const port = int(flags, "port") ?? loadConfig().port ?? DEFAULT_PORT;
  const idle = int(flags, "idle-timeout") ?? DEFAULT_IDLE_SECONDS;
  const url = `http://127.0.0.1:${port}/`;
  const open = () => { if (flags["no-open"] !== true) openBrowser(url); };
  if (await runningAt(url, port)) {
    console.log(`Work Tracker is already running at ${url}`);
    open();
    return;
  }
  const repo = str(flags, "repo");
  const env = { ...process.env, ...(repo ? { WORK_TRACKER_REPO_ROOT: resolve(repo) } : {}) };
  const log = openBackendLog();
  let child: ChildProcess | undefined;
  let opened = false;
  let ending = false;
  await new Promise<void>((resolveDone) => {
    const done = () => {
      ending = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolveDone();
    };
    const supervisor: BackendSupervisor = new BackendSupervisor({
      logPath: log.path,
      log: (line) => log.write(`[${new Date().toISOString()}] ${line}\n`),
      spawn: (handlers: BackendHandlers) => {
        child = fork(process.argv[1]!, ["__backend", "--port", String(port), "--idle-timeout", String(idle)], { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
        child.stdout?.on("data", (chunk: Buffer) => { process.stdout.write(chunk); log.write(chunk); });
        child.stderr?.on("data", (chunk: Buffer) => { process.stderr.write(chunk); log.write(chunk); });
        child.on("message", (message) => {
          if ((message as { type?: string })?.type === "idle") supervisor.stop();
          else handlers.message(message as Parameters<BackendHandlers["message"]>[0]);
        });
        child.on("exit", (code) => handlers.exit(code ?? 1));
        const current = child;
        return { postMessage: (message) => current.connected && current.send(message as object), kill: () => current.kill("SIGKILL") };
      },
      onReady: () => {
        console.log(JSON.stringify({ type: "ready", address: url.slice(0, -1), port }));
        if (!opened) open();
        opened = true;
      },
      onUnavailable: (message) => console.error(message),
      onState: (state) => {
        if (state.status === "unavailable") setTimeout(() => { if (!ending) supervisor.restart(); }, RESTART_DELAY_MS);
        if (state.status !== "failed") return;
        console.error(`Work Tracker stopped after repeated failures. See ${log.path}`);
        process.exitCode = 1;
        done();
      },
      onStopped: () => {
        console.log(JSON.stringify({ type: "stopped" }));
        done();
      },
    });
    function stop() {
      if (!supervisor.stop()) return done();
      setTimeout(() => supervisor.kill(), SHUTDOWN_TIMEOUT_MS).unref();
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    supervisor.start();
  });
}
