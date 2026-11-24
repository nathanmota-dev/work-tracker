import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executableExists } from "../../cli/doctor.ts";
import { agentEnvironment } from "../../cli/skills.ts";
import { paths } from "../../paths.ts";
import { runCommand } from "../../preparation/command.ts";

/** Pinned uv release; each archive is verified against its published SHA-256. */
export const UV_VERSION = "0.13.7";
export const UV_SHA256: Record<string, string> = {
  "x86_64-unknown-linux-gnu": "c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83",
  "aarch64-unknown-linux-gnu": "71279f8d3c67241e807b9d8db872d1bf541579fb9f08b7d1eb1682196d1e57dc",
  "x86_64-apple-darwin": "20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7",
  "aarch64-apple-darwin": "81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731",
};
export function uvTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | null {
  const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null;
  const os = platform === "linux" ? "unknown-linux-gnu" : platform === "darwin" ? "apple-darwin" : null;
  return cpu && os ? `${cpu}-${os}` : null;
}
export const uvPath = () => join(paths.bin, "uv");

async function download(url: string, sha256: string, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("The downloaded uv archive failed its integrity check.");
  return bytes;
}

/**
 * The uv executable: the user's own on PATH, the app's copy, or a pinned
 * release downloaded into the app's bin folder. Nothing is installed globally.
 */
export async function ensureUv(signal?: AbortSignal): Promise<string> {
  if (existsSync(uvPath())) return uvPath();
  if (executableExists("uv", agentEnvironment())) return "uv";
  const target = uvTarget();
  if (!target) throw new Error("Automatic installation is not available on this system. Install uv and mcp-server-linkedin, then test the integration.");
  const name = `uv-${target}`;
  const bytes = await download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${name}.tar.gz`, UV_SHA256[target]!, signal);
  const work = join(paths.tools, `.uv-${randomUUID()}`);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(work, "uv.tar.gz"), bytes, { mode: 0o600 });
    await runCommand("tar", ["-xzf", join(work, "uv.tar.gz"), "-C", work], undefined, signal, 120000);
    mkdirSync(paths.bin, { recursive: true, mode: 0o700 });
    chmodSync(join(work, name, "uv"), 0o755);
    renameSync(join(work, name, "uv"), uvPath());
  } finally { rmSync(work, { recursive: true, force: true }); }
  return uvPath();
}
