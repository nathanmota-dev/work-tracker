import { spawnOwned, stopOwned } from "../acp/process.ts";
import { agentEnvironment } from "../cli/skills.ts";

/** Run a tool with literal arguments; resolves with its combined, bounded output. */
export async function runCommand(command: string, args: string[], cwd?: string, signal?: AbortSignal, timeoutMs = 90000): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawnOwned(command, args, { cwd, env: agentEnvironment() });
    let output = "";
    let failure: Error | undefined;
    const abort = () => { failure = new Error("Cancelled"); stopOwned(child); };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { failure = new Error(`${command} timed out.`); stopOwned(child); }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + String(chunk)).slice(-1024 * 1024); });
    child.once("error", error => { failure = new Error(`Could not run ${command}: ${error.message}. Install it and make it available on PATH.`); });
    child.once("close", code => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${command} failed (${code}):\n${output}`));
      else resolve(output);
    });
  });
}
