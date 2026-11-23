import { existsSync } from "node:fs";
import { runCommand } from "./command.ts";
import { LayoutUnavailable, readBbox } from "./layout/bbox.ts";
import { layoutFindings, type Finding } from "./layout/findings.ts";
import { textLayerFindings, type Identity } from "./text-layer.ts";

/**
 * `identity` enables the contact-detail check. With `baseline` (the base resume's PDF),
 * only findings the base does not have are reported, so a decision of the user's own
 * template is never attributed to the tailoring.
 */
export interface ReviewOptions { identity?: Identity; baseline?: string }
/** `layout` is absent when the extractor could not measure the PDF; `skipped` says why. */
export interface PdfReview { layout?: Finding[]; text: Finding[]; skipped?: string }

/** Layout and text-layer findings. A broken extractor skips the layout part instead of failing it. */
export async function reviewPdf(path: string, text: string, identity?: Identity, signal?: AbortSignal): Promise<PdfReview> {
  const textFindings = textLayerFindings(text, identity);
  try {
    return { layout: layoutFindings(await readBbox(path, signal)), text: textFindings };
  } catch (error) {
    if (!(error instanceof LayoutUnavailable)) throw error;
    return { text: textFindings, skipped: error.message };
  }
}

async function reviewBaseline(path: string, identity: Identity | undefined, signal?: AbortSignal): Promise<PdfReview> {
  try {
    return await reviewPdf(path, await runCommand("pdftotext", ["-layout", path, "-"], undefined, signal), identity, signal);
  } catch (error) {
    signal?.throwIfAborted();
    return { text: [], skipped: `the base PDF could not be read (${(error instanceof Error ? error.message : String(error)).split("\n")[0]})` };
  }
}

/** Warnings for the PDF review list; checks warn and never block generation or approval. */
export async function reviewWarnings(path: string, text: string, { identity, baseline }: ReviewOptions, signal?: AbortSignal): Promise<string[]> {
  const current = await reviewPdf(path, text, identity, signal);
  const base = baseline && existsSync(baseline) ? await reviewBaseline(baseline, identity, signal) : undefined;
  // Without the base's geometry the layout cannot be compared, so it is skipped too.
  const layout = base?.skipped ? [] : current.layout ?? [];
  const skipped = current.skipped ?? base?.skipped;
  const known = new Set([...base?.layout ?? [], ...base?.text ?? []].map(finding => finding.code));
  return [
    ...[...layout, ...current.text].filter(finding => !known.has(finding.code)).map(finding => finding.message),
    ...skipped ? [`Layout check skipped: ${skipped}.`] : [],
  ];
}
