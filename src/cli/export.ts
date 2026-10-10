import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { reqStr, type Flags } from "./flags.ts";

/**
 * work-tracker export --typ <file> --out <file.pdf>
 *
 * Shared Typst→PDF compile step. Owned here (not inside resume-tailor) so any
 * skill — resume-tailor for the resume, portal-filler for uploads — can produce
 * the real PDF file that Chrome MCP's upload_file requires.
 *
 * Requires the `typst` binary on PATH. We fail loudly with install guidance
 * rather than silently emitting nothing.
 */
export async function exportCmd(flags: Flags): Promise<void> {
  const typ = reqStr(flags, "typ");
  const out = reqStr(flags, "out");

  if (!existsSync(typ)) {
    console.error(`error: input not found: ${typ}`);
    process.exit(1);
  }

  mkdirSync(dirname(out), { recursive: true });

  const proc = spawnSync("typst", ["compile", typ, out], { encoding: "utf8", timeout: 60000 });
  if (proc.status !== 0) {
    console.error(`error: typst compile failed:\n${proc.error?.message ?? proc.stderr}`);
    process.exit(1);
  }

  console.log(`exported ${out}`);
}
