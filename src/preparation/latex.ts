import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { runCommand } from "./command.ts";
import { reviewWarnings, type ReviewOptions } from "./pdf-review.ts";
import type { LatexEngine } from "./types.ts";
export { runCommand };

export async function dependencyStatus(engine: LatexEngine) {
  return Promise.all(["latexmk", engine, "pdfinfo", "pdftotext"].map(async command => {
    try { await runCommand(command, [command === "pdfinfo" || command === "pdftotext" ? "-v" : "--version"], undefined, undefined, 5000); return { command, available: true }; }
    catch { return { command, available: false }; }
  }));
}
export interface PdfCheck { pages: number; text: string; warnings: string[] }
/** `layout` adds the layout and text-layer review; its findings are warnings, never failures. */
export interface PdfCheckOptions { layout?: ReviewOptions }
export async function inspectPdf(path: string, signal?: AbortSignal, options: PdfCheckOptions = {}): Promise<PdfCheck> {
  if (!readFileSync(path).subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("The generated file is not a PDF.");
  const info = await runCommand("pdfinfo", [path], undefined, signal);
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  const text = await runCommand("pdftotext", ["-layout", path, "-"], undefined, signal);
  if (!pages || !text.trim()) throw new Error("The PDF must contain at least one page with extractable text.");
  const warnings = options.layout ? await reviewWarnings(path, text, options.layout, signal) : [];
  return { pages, text, warnings };
}
export async function compileLatex(project: string, mainFile: string, engine: LatexEngine, signal?: AbortSignal, options?: PdfCheckOptions): Promise<{ path: string; log: string; check: PdfCheck }> {
  const output = join(project, "output");
  mkdirSync(output, { recursive: true });
  const flags = { pdflatex: "-pdf", xelatex: "-xelatex", lualatex: "-lualatex" };
  const log = await runCommand("latexmk", ["-norc", flags[engine], `-${engine}=${engine} -no-shell-escape %O %S`, "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", `-outdir=${output}`, mainFile], project, signal);
  const path = join(output, basename(mainFile, ".tex") + ".pdf");
  const check = await inspectPdf(path, signal, options);
  if (/Overfull \\[hv]box/.test(log)) check.warnings.unshift("LaTeX reported overflowing content. Review the PDF layout.");
  return { path, log, check };
}
