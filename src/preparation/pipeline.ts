import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { paths } from "../paths.ts";
import { contactIdentity } from "../answers/store.ts";
import { compileLatex } from "./latex.ts";
import { writeSnapshot, type SourcesSnapshot } from "./sources.ts";
import { addArtifact, artifactFile, cachedPreview } from "./store.ts";
import type { PdfArtifact, PreparationPhase } from "./types.ts";
import { readTailoringOutput, validateTailoredSources, type GenerationSources, type TailoringPaths } from "./generation.ts";

export type Compiled = { compiled: Awaited<ReturnType<typeof compileLatex>>; report: string };

/** Write the snapshot twice (pristine and working copy) and the profile next to them. */
export function writeProject(root: string, snapshot: SourcesSnapshot): { baseProject: string; project: string; profilePath: string } {
  const baseProject = join(root, "base-project");
  const project = join(root, "project");
  const profilePath = join(root, "profile.json");
  writeSnapshot(snapshot, baseProject);
  writeSnapshot(snapshot, project);
  writeFileSync(profilePath, JSON.stringify(snapshot.data, null, 2), { mode: 0o600 });
  return { baseProject, project, profilePath };
}

/** The base PDF of these sources, compiled once per source version. */
export async function basePreview(snapshot: SourcesSnapshot, signal?: AbortSignal): Promise<PdfArtifact> {
  const cached = cachedPreview(snapshot.version);
  if (cached) return cached;
  const project = join(paths.artifacts, "base", snapshot.version, "project");
  writeSnapshot(snapshot, project);
  const result = await compileLatex(project, snapshot.config.mainFile, snapshot.config.engine, signal, { layout: { identity: contactIdentity() } });
  writeFileSync(join(dirname(project), "compile.log"), result.log);
  return addArtifact(null, "base", result.path, result.check, snapshot.version);
}

/** Copy the base PDF next to a generation as its layout baseline. */
export function copyBaseline(preview: PdfArtifact, root: string): { path: string; text: string } {
  const baseline = artifactFile(preview.id);
  const path = join(root, "base.pdf");
  copyFileSync(baseline.path, path);
  return { path, text: baseline.text };
}

/** The original LaTeX files the tailored project is validated against. */
export function texSources(snapshot: SourcesSnapshot): GenerationSources["texFiles"] {
  return snapshot.files.filter(file => file.name.endsWith(".tex")).map(file => ({ name: file.name, text: file.bytes.toString("utf8").replaceAll("\r\n", "\n") }));
}

/**
 * Compile the tailored project, allowing one bounded agent correction. Undefined
 * while the correction waits for sign-in.
 *
 * @param hooks.phase Records the current phase.
 * @param hooks.correct Asks the agent to fix the error; false while waiting for sign-in.
 */
export async function compileWithCorrection(sources: GenerationSources<TailoringPaths>, signal: AbortSignal, hooks: { phase(phase: PreparationPhase): void; correct(message: string): Promise<boolean> }): Promise<Compiled | undefined> {
  const { manifest } = sources;
  for (let attempt = 0; ; attempt++) {
    hooks.phase("compiling");
    try {
      validateTailoredSources(sources);
      // Layout findings the base PDF already has belong to the user's template, not to the tailoring.
      const compiled = await compileLatex(manifest.project, manifest.mainFile, manifest.engine, signal, { layout: { identity: contactIdentity(), baseline: join(dirname(manifest.manifestPath), "base.pdf") } });
      writeFileSync(join(dirname(manifest.manifestPath), "compile.log"), compiled.log);
      return { compiled, report: readTailoringOutput(manifest) };
    } catch (error) {
      signal.throwIfAborted();
      if (attempt === 1) throw error;
      hooks.phase("tailoring");
      if (!await hooks.correct(`Correct the compilation or output errors below without inventing information.\n${error instanceof Error ? error.message : String(error)}`)) return undefined;
    }
  }
}

/** A tailored resume longer than its base needs the candidate's attention. */
export function warnLength(compiled: Compiled["compiled"], basePages: number): void {
  if (compiled.check.pages > basePages) compiled.check.warnings.unshift(`The tailored resume has ${compiled.check.pages} pages; the base has ${basePages}. Review its length.`);
}
