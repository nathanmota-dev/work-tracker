import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../paths.ts";
import type { Flags } from "./flags.ts";
/** Linux cleanup matches an exact profile argument, never the shared LinkedIn profile. */
export async function sweepLinkedinBrowsers(): Promise<{ killed: number; locksCleared: number }> {
  let killed = 0;
  if (process.platform !== "linux") throw new Error("Profile cleanup is currently supported on Linux only");
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const args = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      const exactProfile = args.includes(`--user-data-dir=${paths.linkedinProfile}`) || args.some((a, i) => a === "--user-data-dir" && args[i + 1] === paths.linkedinProfile);
      if (exactProfile && /(?:chrome|chromium)/.test(args[0] ?? "")) { process.kill(Number(entry), "SIGKILL"); killed++; }
    } catch { /* process exited */ }
  }
  let locksCleared = 0;
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { rmSync(join(paths.linkedinProfile, name)); locksCleared++; } catch { /* absent */ }
  }
  return { killed, locksCleared };
}
export async function linkedinCmd(sub: string, _flags: Flags): Promise<void> {
  if (sub !== "reset") throw new Error("usage: work-tracker linkedin reset");
  console.log(await sweepLinkedinBrowsers());
}
