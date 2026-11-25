import { existsSync } from "node:fs";
import { join } from "node:path";
import { PreparationError } from "../preparation/sources.ts";
import { artifactFile } from "../preparation/store.ts";
import { saveVariantDocument } from "../preparation/documents.ts";
import { useReadyPdf } from "../preparation/ready-pdf.ts";
import { SAVED_RESUME, type PreparationRun } from "../preparation/types.ts";
import { variantManifest, variantRecord } from "./store.ts";
import { variantId } from "./validation.ts";

/** The base PDF and its text a variant's document is compared with; an imported PDF is its own base. */
function variantBase(manifest: { manifestPath?: string; baseArtifactId?: string }, pdfPath: string, pdfText: string): { path: string; text: string } {
  const basePath = manifest.manifestPath ? join(manifest.manifestPath, "..", "base.pdf") : "";
  if (!manifest.baseArtifactId || !existsSync(basePath)) return { path: pdfPath, text: pdfText };
  try { return { path: basePath, text: artifactFile(manifest.baseArtifactId).text }; } catch { return { path: basePath, text: pdfText }; }
}

/**
 * Prepare an application with a saved resume, without calling the agent; see
 * useReadyPdf. Choosing the same unchanged saved resume again keeps the
 * application's current execution.
 */
export function useVariant(input: Record<string, unknown>, assertIdle: () => void): PreparationRun {
  return useReadyPdf(input, assertIdle, () => {
    const variant = variantRecord(variantId(input.variantId));
    if (variant.archivedAt) throw new PreparationError("This saved resume is archived. Restore it or choose another one.", 409);
    if (variant.status !== "ready" || !variant.pdf) throw new PreparationError("This saved resume is not ready.", 409);
    const source = artifactFile(variant.pdf.id);
    const manifest = variantManifest(variant.id);
    return {
      provider: SAVED_RESUME, options: { variantId: variant.id }, changedAt: variant.updatedAt,
      pdf: { path: source.path, text: source.text, pages: variant.pdf.pages, warnings: variant.pdf.warnings },
      base: variantBase(manifest, source.path, source.text),
      report: variant.report, defaultReport: `Saved resume "${variant.name}", imported as a ready PDF.`,
      activity: job => `Used saved resume ${variant.name} for ${job.company_name} ${job.title}`,
      saveDocument: (d, run) => saveVariantDocument(d, { ...run, variant, manifest }),
    };
  });
}
