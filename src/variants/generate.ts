import { randomUUID } from "node:crypto";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db/index.ts";
import { paths } from "../paths.ts";
import type { SourcesSnapshot } from "../preparation/sources.ts";
import { addArtifact } from "../preparation/store.ts";
import { basePreview, compileWithCorrection, copyBaseline, texSources, warnLength, writeProject } from "../preparation/pipeline.ts";
import { updateVariant, variantRecord } from "./store.ts";
import type { VariantManifest, VariantPhase } from "./types.ts";

/**
 * @property phase Records the current phase.
 * @property agent Runs the resume-tailor skill on the manifest; false while it waits for sign-in.
 */
export interface GenerationHooks {
  phase(phase: VariantPhase): void;
  agent(manifestPath: string, extra: string): Promise<boolean>;
}

/**
 * Generate a variant's PDF from `snapshot`: write the project, tailor it for the
 * role and stacks, then compile and validate it like Apply does. Each generation
 * has its own folder, so earlier PDFs stay intact for the documents that used
 * them. False while the agent waits for sign-in.
 */
export async function generateVariant(id: string, snapshot: SourcesSnapshot, signal: AbortSignal, hooks: GenerationHooks): Promise<boolean> {
  const variant = variantRecord(id);
  const root = join(paths.artifacts, "variants", id, randomUUID());
  const { baseProject, project, profilePath } = writeProject(root, snapshot);
  const preview = await basePreview(snapshot, signal);
  copyBaseline(preview, root);
  const manifest: VariantManifest = {
    variantId: id, target: { kind: "variant", role: variant.role, stacks: variant.stacks, focus: variant.focus, language: variant.language },
    project, baseProject, mainFile: snapshot.config.mainFile, engine: snapshot.config.engine, profilePath,
    reportPath: join(root, "report.md"), selectionPath: join(root, "selection.json"), coverPath: null,
    sourceVersion: snapshot.version, warnings: snapshot.warnings, manifestPath: join(root, "manifest.json"), baseArtifactId: preview.id,
  };
  writeFileSync(manifest.manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  updateVariant(id, { manifest_json: JSON.stringify(manifest) });
  signal.throwIfAborted();
  hooks.phase("tailoring");
  if (!await hooks.agent(manifest.manifestPath, "")) return false;
  const result = await compileWithCorrection({ manifest, texFiles: texSources(snapshot), basePages: preview.pages }, signal, {
    phase: phase => hooks.phase(phase === "tailoring" ? "tailoring" : "compiling"),
    correct: message => hooks.agent(manifest.manifestPath, message),
  });
  if (!result) return false;
  warnLength(result.compiled, preview.pages);
  const pdfPath = join(root, "resume.pdf");
  copyFileSync(result.compiled.path, pdfPath);
  const d = db();
  d.transaction(() => {
    const pdf = addArtifact(null, "variant", pdfPath, result.compiled.check, snapshot.version);
    updateVariant(id, { status: "ready", phase: "complete", pdf_artifact_id: pdf.id, report: result.report, error: null, source_version: snapshot.version });
    d.query("INSERT INTO activity_log (kind, skill, summary) VALUES ('resume', 'work-tracker-resume-tailor', ?)").run(`Generated saved resume ${variant.name}`);
  })();
  return true;
}
