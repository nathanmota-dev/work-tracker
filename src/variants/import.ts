import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { db } from "../db/index.ts";
import { paths } from "../paths.ts";
import { inspectPdf } from "../preparation/latex.ts";
import { PreparationError } from "../preparation/sources.ts";
import { addArtifact } from "../preparation/store.ts";
import { insertVariant } from "./store.ts";
import { variantProfile } from "./validation.ts";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Import a resume PDF the candidate already has, without LaTeX sources. The file
 * is copied into the artifact folder and must have pages with extractable text.
 * Returns the new variant's ID.
 */
export async function importVariantPdf(input: Record<string, unknown>): Promise<string> {
  const profile = variantProfile(input);
  const source = typeof input.path === "string" ? input.path : "";
  if (!isAbsolute(source) || extname(source).toLowerCase() !== ".pdf") throw new PreparationError("Choose a PDF file.");
  let size: number;
  try { size = statSync(source).size; } catch { throw new PreparationError("The selected PDF was not found.", 404); }
  if (size > MAX_BYTES) throw new PreparationError("The PDF must have at most 10 MB.");
  const id = randomUUID();
  const folder = join(paths.artifacts, "variants", id, "imported");
  const path = join(folder, "resume.pdf");
  mkdirSync(folder, { recursive: true });
  copyFileSync(source, path);
  try {
    const check = await inspectPdf(path);
    const d = db();
    d.transaction(() => {
      const pdf = addArtifact(null, "variant", path, check);
      insertVariant(id, profile, "imported", pdf.id);
      d.query("INSERT INTO activity_log (kind, skill, summary) VALUES ('resume', 'resume-import', ?)").run(`Imported saved resume ${profile.name}`);
    })();
    return id;
  } catch (error) {
    rmSync(join(paths.artifacts, "variants", id), { recursive: true, force: true });
    if (error instanceof PreparationError) throw error;
    throw new PreparationError(`The PDF could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}
