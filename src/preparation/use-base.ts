import { artifactFile } from "./store.ts";
import { saveBaseDocument } from "./documents.ts";
import { useReadyPdf } from "./ready-pdf.ts";
import { BASE_RESUME, type PdfArtifact, type PreparationRun } from "./types.ts";

/**
 * Prepare an application with the base resume as it is, without tailoring;
 * see useReadyPdf. `preview` is the compiled base PDF of `sourceVersion`, so
 * choosing it again keeps the execution until the base sources change.
 */
export function useBase(input: Record<string, unknown>, assertIdle: () => void, sourceVersion: string, preview: PdfArtifact): PreparationRun {
  return useReadyPdf(input, assertIdle, () => {
    const file = artifactFile(preview.id);
    return {
      provider: BASE_RESUME, options: { sourceVersion }, changedAt: "",
      pdf: { path: file.path, text: file.text, pages: preview.pages, warnings: preview.warnings },
      base: { path: file.path, text: file.text },
      report: null, defaultReport: "Base resume used as it is, without tailoring.",
      activity: job => `Used the base resume for ${job.company_name} ${job.title}`,
      saveDocument: (d, run) => saveBaseDocument(d, { ...run, sourceVersion }),
    };
  });
}
