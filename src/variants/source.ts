import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { contactIdentity } from "../answers/store.ts";
import { db } from "../db/index.ts";
import { paths } from "../paths.ts";
import { compileLatex } from "../preparation/latex.ts";
import { PreparationError } from "../preparation/sources.ts";
import { addArtifact, runManifest } from "../preparation/store.ts";
import type { LatexEngine } from "../preparation/types.ts";
import { updateVariant, variantManifest, variantRecord } from "./store.ts";
import type { ResumeVariant, VariantLatex, VariantLatexFile } from "./types.ts";

/** Largest `.tex` file a save accepts. */
const MAX_FILE_BYTES = 1024 * 1024;
/** The compiler's output folder inside a project; never part of the sources. */
const OUTPUT = "output";
const NO_SOURCE = "This resume has no LaTeX source to edit.";

/**
 * Where a saved resume's LaTeX project is. `owned` is false while it is still
 * the project of the Apply execution it was approved from: the first save copies it.
 */
export interface VariantProject { project: string; mainFile: string; engine: LatexEngine; owned: boolean }

/** `path` resolved, when it is a folder inside the artifact folder. */
function insideArtifacts(path: string | undefined): string | null {
  if (!path || !existsSync(path)) return null;
  const real = realpathSync(path);
  const rel = relative(realpathSync(paths.artifacts), real);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? real : null;
}

/** The project of the Apply execution whose approved version the resume was saved from. */
function applyProject(variant: ResumeVariant): Omit<VariantProject, "owned"> | null {
  const versionId = variant.source?.documentVersionId;
  if (!versionId) return null;
  const row = db().query("SELECT run_id FROM document_versions WHERE id = ?").get(versionId) as { run_id: string } | undefined;
  if (!row) return null;
  const manifest = runManifest(row.run_id) as Record<string, string>;
  const project = insideArtifacts(manifest.project);
  return project && manifest.mainFile ? { project, mainFile: manifest.mainFile, engine: manifest.engine as LatexEngine } : null;
}

export function resolveVariantProject(id: string): VariantProject {
  const variant = variantRecord(id);
  const manifest = variantManifest(id);
  const own = insideArtifacts(manifest.project);
  if (own && manifest.mainFile && manifest.engine) return { project: own, mainFile: manifest.mainFile, engine: manifest.engine, owned: true };
  const borrowed = applyProject(variant);
  if (borrowed) return { ...borrowed, owned: false };
  throw new PreparationError(NO_SOURCE, 409);
}

/** The `.tex` files of `project` by relative name, main file first, without compiler output. */
function texNames(project: string, mainFile: string): string[] {
  const names = readdirSync(project, { recursive: true, withFileTypes: true })
    .filter(item => item.isFile() && item.name.endsWith(".tex"))
    .map(item => relative(project, join(item.parentPath, item.name)).split(sep).join("/"))
    .filter(name => name !== OUTPUT && !name.startsWith(`${OUTPUT}/`))
    .sort();
  return [mainFile, ...names.filter(name => name !== mainFile)].filter(name => names.includes(name));
}

const read = (project: string, name: string) => readFileSync(join(project, name), "utf8").replaceAll("\r\n", "\n");

export function readVariantLatex(id: string): VariantLatex {
  const { project, mainFile } = resolveVariantProject(id);
  const names = texNames(project, mainFile);
  if (!names.length) throw new PreparationError(NO_SOURCE, 409);
  return { mainFile, files: names.map(name => ({ name, text: read(project, name) })) };
}

/** Each entry must be a known `.tex` file of the project with text within the size limit. */
function validFiles(input: unknown, known: string[]): VariantLatexFile[] {
  if (!Array.isArray(input) || !input.length) throw new PreparationError("Send the LaTeX files to save.");
  const seen = new Set<string>();
  return input.map(item => {
    const { name, text } = (item ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof text !== "string") throw new PreparationError("Each file needs a name and text.");
    if (!known.includes(name) || seen.has(name)) throw new PreparationError(`Unknown LaTeX file: ${name}`);
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new PreparationError(`${name} is larger than 1 MB.`);
    seen.add(name);
    return { name, text };
  });
}

/** A resume tailored in Apply gets its own copy of the project before its first edit; the Apply project stays as approved. */
function ownProject(id: string, source: VariantProject): string {
  if (source.owned) return source.project;
  const project = join(paths.artifacts, "variants", id, "source", "project");
  mkdirSync(join(project, ".."), { recursive: true });
  cpSync(source.project, project, { recursive: true, filter: path => relative(source.project, path) !== OUTPUT });
  updateVariant(id, { manifest_json: JSON.stringify({ ...variantManifest(id), project, mainFile: source.mainFile, engine: source.engine }) });
  return project;
}

/** The `file:line: message` errors of a LaTeX log, or its tail when it names none. */
export function latexErrors(log: string): string {
  const lines = [...new Set(log.split("\n").filter(line => /^[^\s:]+\.tex:\d+: /.test(line)))];
  return lines.length ? lines.slice(0, 20).join("\n") : log.trim().split("\n").slice(-20).join("\n");
}

const saving = new Set<string>();

/**
 * Write the edited files and compile them. A successful build adds a new PDF;
 * earlier PDFs stay for the documents that used them. On a compilation error
 * the files stay saved, the PDF is unchanged, and the error lists the LaTeX errors.
 */
export async function saveVariantLatex(id: string, input: unknown, signal?: AbortSignal): Promise<ResumeVariant> {
  const variant = variantRecord(id);
  if (variant.status === "generating" || variant.status === "waiting_for_sign_in") throw new PreparationError("Wait for this resume's generation to finish before editing it.", 409);
  if (variant.archivedAt) throw new PreparationError("Restore this saved resume before editing it.", 409);
  if (saving.has(id)) throw new PreparationError("This resume is already being saved.", 409);
  saving.add(id);
  try {
    const source = resolveVariantProject(id);
    const files = validFiles(input, texNames(source.project, source.mainFile));
    const project = ownProject(id, source);
    for (const file of files) writeFileSync(join(project, file.name), file.text);
    let compiled: Awaited<ReturnType<typeof compileLatex>>;
    try { compiled = await compileLatex(project, source.mainFile, source.engine, signal, { layout: { identity: contactIdentity() } }); }
    catch (error) {
      signal?.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      throw new PreparationError(`LaTeX could not compile the resume. Your changes are saved.\n${latexErrors(message)}`, 422);
    }
    const pdfPath = join(paths.artifacts, "variants", id, randomUUID(), "resume.pdf");
    mkdirSync(join(pdfPath, ".."), { recursive: true });
    copyFileSync(compiled.path, pdfPath);
    const d = db();
    d.transaction(() => {
      const pdf = addArtifact(null, "variant", pdfPath, compiled.check, variant.sourceVersion ?? undefined);
      updateVariant(id, { pdf_artifact_id: pdf.id, error: null });
      d.query("INSERT INTO activity_log (kind, skill, summary) VALUES ('resume', 'saved-resume', ?)").run(`Edited saved resume ${variant.name}`);
    })();
    return variantRecord(id);
  } finally { saving.delete(id); }
}
