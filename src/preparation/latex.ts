import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnOwned, stopOwned } from "../acp/process.ts";
import { agentEnvironment } from "../cli/skills.ts";
import type { LatexEngine } from "./types.ts";

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
export async function dependencyStatus(engine: LatexEngine) {
  return Promise.all(["latexmk", engine, "pdfinfo", "pdftotext"].map(async command => {
    try { await runCommand(command, [command === "pdfinfo" || command === "pdftotext" ? "-v" : "--version"], undefined, undefined, 5000); return { command, available: true }; }
    catch { return { command, available: false }; }
  }));
}
export interface PdfCheck { pages: number; text: string; warnings: string[] }
export async function inspectPdf(path: string, signal?: AbortSignal): Promise<PdfCheck> {
  if (!readFileSync(path).subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("The generated file is not a PDF.");
  const info = await runCommand("pdfinfo", [path], undefined, signal);
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  const text = await runCommand("pdftotext", ["-layout", path, "-"], undefined, signal);
  if (!pages || !text.trim()) throw new Error("The PDF must contain at least one page with extractable text.");
  return { pages, text, warnings: [] };
}
export async function compileLatex(project: string, mainFile: string, engine: LatexEngine, signal?: AbortSignal): Promise<{ path: string; log: string; check: PdfCheck }> {
  const output = join(project, "output");
  mkdirSync(output, { recursive: true });
  const flags = { pdflatex: "-pdf", xelatex: "-xelatex", lualatex: "-lualatex" };
  const log = await runCommand("latexmk", ["-norc", flags[engine], `-${engine}=${engine} -no-shell-escape %O %S`, "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", `-outdir=${output}`, mainFile], project, signal);
  const path = join(output, basename(mainFile, ".tex") + ".pdf");
  const check = await inspectPdf(path, signal);
  if (/Overfull \\[hv]box/.test(log)) check.warnings.push("LaTeX reported overflowing content. Review the PDF layout.");
  return { path, log, check };
}
