import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
const children = new Set<ChildProcessWithoutNullStreams>();
export function spawnOwned(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const child = spawn(command, args, { ...options, stdio: "pipe", detached: process.platform !== "win32" });
  children.add(child);
  child.once("error", () => children.delete(child));
  return child;
}
export function stopOwned(child: ChildProcessWithoutNullStreams): void {
  // Keep ownership until cleanup: descendants can outlive the direct child.
  try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM"); else child.kill(); } catch { /* already exited */ }
  const timer = setTimeout(() => {
    try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already exited */ }
    children.delete(child);
  }, 300);
  timer.unref();
}
export async function stopAllOwned(): Promise<void> {
  for (const child of children) stopOwned(child);
  if (children.size) await new Promise(resolve => setTimeout(resolve, 350));
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
