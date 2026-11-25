import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
type Owned = { graceMs: number; closed: boolean; stopping?: Promise<void> };
/** Time descendants get to exit after their group is asked to stop. */
const settleMs = 300;
const children = new Map<ChildProcessWithoutNullStreams, Owned>();
/**
 * `graceMs` lets a process that must save state on exit, such as a browser
 * writing its cookies, finish before its group is killed.
 */
export function spawnOwned(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; graceMs?: number } = {}) {
  const { graceMs = settleMs, ...spawnOptions } = options;
  const child = spawn(command, args, { ...spawnOptions, stdio: "pipe", detached: process.platform !== "win32" });
  const owned: Owned = { graceMs, closed: false };
  children.set(child, owned);
  child.once("error", () => children.delete(child));
  child.once("close", () => { owned.closed = true; });
  return child;
}
function signalGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
}
/** Resolves once the process group has been killed; repeated calls share one stop. */
export function stopOwned(child: ChildProcessWithoutNullStreams): Promise<void> {
  const owned = children.get(child);
  if (owned?.stopping) return owned.stopping;
  // Keep ownership until cleanup: descendants can outlive the direct child.
  signalGroup(child, "SIGTERM");
  const graceMs = owned && !owned.closed ? owned.graceMs : settleMs;
  const stopping = new Promise<void>(resolve => {
    const kill = () => {
      clearTimeout(timer);
      child.off("close", kill);
      signalGroup(child, "SIGKILL");
      children.delete(child);
      resolve();
    };
    const timer = setTimeout(kill, graceMs);
    timer.unref();
    // A process given extra time is killed with its group as soon as it exits.
    if (graceMs > settleMs) child.once("close", kill);
  });
  if (owned) owned.stopping = stopping;
  return stopping;
}
export async function stopAllOwned(): Promise<void> {
  await Promise.all([...children.keys()].map(stopOwned));
}
export async function capture(command: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise(resolve => {
    const child = spawnOwned(command, args);
    let out = "";
    const timer = setTimeout(() => { stopOwned(child); resolve(null); }, timeoutMs);
    child.stdout.on("data", chunk => { out += chunk; if (out.length > 4_000_000) { stopOwned(child); } });
    child.once("error", () => { clearTimeout(timer); resolve(null); });
    child.once("close", code => { clearTimeout(timer); stopOwned(child); resolve(code === 0 ? out : null); });
  });
}
