import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, join, dirname } from "node:path";
import { loadConfig, saveConfig } from "../paths.ts";
import type { ResumeSourcesConfig } from "./types.ts";
import { isFolder, profileEvidence } from "../profile/evidence.ts";
import { canonicalSkill } from "../ats/vocabulary.ts";

export class PreparationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function isFile(path: string): boolean {
  try { return statSync(path).isFile(); }
  catch { return false; }
}
/** A saved configuration from before the profile folder uses the data file's folder. */
function withProfileDir(saved: Omit<ResumeSourcesConfig, "profileDir"> & { profileDir?: string }): ResumeSourcesConfig {
  return { ...saved, profileDir: saved.profileDir ?? (saved.dataFile ? dirname(saved.dataFile) : "") };
}
export function sourcesConfig(): ResumeSourcesConfig {
  const saved = loadConfig().resumeSources;
  if (saved?.projectDir) return withProfileDir(saved);
  // The installed desktop app supplies its build checkout; the CLI uses its cwd.
  // Only real local inputs are defaults: the versioned examples require filling in.
  const root = resolve(process.env.WORK_TRACKER_REPO_ROOT ?? process.cwd());
  const projectDir = join(root, "base", "latex");
  const data = join(root, "base", "data");
  const profileDir = isFolder(data) ? data : "";
  if (isFile(join(projectDir, "resume.tex"))) {
    const dataFile = isFile(join(data, "resume-data.json")) ? join(data, "resume-data.json") : "";
    return { projectDir, mainFile: "resume.tex", dataFile, engine: "pdflatex", profileDir };
  }
  return { projectDir: "", mainFile: "resume.tex", dataFile: "", engine: "pdflatex", profileDir };
}
export function saveSources(body: unknown): ResumeSourcesConfig {
  if (!body || typeof body !== "object") throw new PreparationError("Expected resume source settings.");
  const value = body as Record<string, unknown>;
  if (!["projectDir", "mainFile", "dataFile", "engine"].every(key => typeof value[key] === "string")) throw new PreparationError("Enter the project folder, main file and compiler.");
  if (value.profileDir !== undefined && typeof value.profileDir !== "string") throw new PreparationError("The profile folder must be a path.");
  const profileDir = typeof value.profileDir === "string" ? value.profileDir.trim() : undefined;
  const config = withProfileDir({ projectDir: String(value.projectDir).trim(), mainFile: String(value.mainFile).trim(), dataFile: String(value.dataFile).trim(), engine: value.engine as ResumeSourcesConfig["engine"], profileDir });
  if (!["pdflatex", "xelatex", "lualatex"].includes(config.engine)) throw new PreparationError("Unknown LaTeX compiler.");
  if (config.profileDir && !isFolder(config.profileDir)) throw new PreparationError("The profile folder must be an absolute path to an existing folder.");
  snapshotSources(config);
  saveConfig({ ...loadConfig(), resumeSources: config });
  return config;
}
export function parseResumeData(text: string, extension: string): Record<string, unknown> {
  if (extension === ".ts") throw new PreparationError("TypeScript resume data is no longer supported. Save the RESUME_DATA object as resume-data.json.");
  if (extension !== ".json") throw new PreparationError("Choose a .json resume data file.");
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { throw new PreparationError(`Invalid resume data: ${(error as Error).message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PreparationError("Resume data must be an object.");
  const result = value as Record<string, unknown>;
  for (const key of ["education", "work", "projects", "skills", "techStack"]) {
    if (result[key] !== undefined && !Array.isArray(result[key])) throw new PreparationError(`${key} must be an array.`);
  }
  const libraries = /^(shadcn[./]ui|nextauth|three\.js|react-icons|@next\/mdx|styled-components|remixicon|swiperjs|scrollreveal|next-intl|framer(?: motion)?)$/i;
  function normalize(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    for (const [key, entry] of Object.entries(obj)) {
      if (["skills", "techStack"].includes(key) && Array.isArray(entry)) {
        if (!entry.every(item => typeof item === "string")) throw new PreparationError(`${key} must contain technology names.`);
        (obj as Record<string, unknown>)[key] = [...new Set(entry.map(canonicalSkill).filter(item => item && !libraries.test(item)))];
      } else if (Array.isArray(entry)) entry.forEach(normalize);
    }
  }
  normalize(result);
  return result;
}
export interface SourcesSnapshot {
  config: ResumeSourcesConfig;
  version: string;
  files: { name: string; bytes: Buffer }[];
  data: Record<string, unknown> | null;
  warnings: string[];
}
const ignored = /(?:^|\/)(?:\.git|node_modules|output)(?:\/|$)|\.(?:aux|log|out|fls|fdb_latexmk|synctex\.gz)$/;
export function snapshotSources(config = sourcesConfig()): SourcesSnapshot {
  if (!["pdflatex", "xelatex", "lualatex"].includes(config.engine)) throw new PreparationError("Unknown LaTeX compiler.");
  if (!config.projectDir || !isAbsolute(config.projectDir)) throw new PreparationError("Choose an absolute path to your LaTeX project folder in Resume sources.");
  if (!existsSync(config.projectDir) || !statSync(config.projectDir).isDirectory()) throw new PreparationError("The LaTeX project folder does not exist.");
  if (!config.mainFile.endsWith(".tex") || isAbsolute(config.mainFile) || config.mainFile.startsWith("-")) throw new PreparationError("The main file must be a relative .tex filename.");
  const root = realpathSync(config.projectDir);
  const entry = resolve(root, config.mainFile);
  if (relative(root, entry).startsWith("..") || !existsSync(entry) || !statSync(entry).isFile()) throw new PreparationError("The main .tex file must be inside the project folder.");
  const files: SourcesSnapshot["files"] = [];
  let total = 0;
  function visit(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (ignored.test(name) || (name.includes(".example.") && name !== config.mainFile.replaceAll("\\", "/"))) continue;
      if (item.isSymbolicLink()) throw new PreparationError(`Copy linked assets into the project folder: ${name}`);
      if (item.isDirectory()) visit(path);
      else if (item.isFile()) {
        total += statSync(path).size;
        if (total > 100 * 1024 * 1024) throw new PreparationError("The LaTeX project exceeds 100 MB. Select only its source folder.");
        files.push({ name, bytes: readFileSync(path) });
      }
    }
  }
  visit(root);
  let data: SourcesSnapshot["data"] = null;
  const warnings: string[] = [];
  if (config.dataFile) {
    if (!isAbsolute(config.dataFile) || !existsSync(config.dataFile)) throw new PreparationError("The resume data file does not exist. Select a file or leave it empty.");
    data = parseResumeData(readFileSync(config.dataFile, "utf8"), config.dataFile.slice(config.dataFile.lastIndexOf(".")));
    for (const key of ["projects", "work"]) {
      const entries = data[key] as Record<string, unknown>[] | undefined;
      if (entries?.some(item => !item || typeof item !== "object" || (!item.description && !item.highlights))) warnings.push(`Some ${key} entries have no descriptions. The agent can use only evidence available in the template and data.`);
    }
  } else warnings.push("No optional data file selected. Tailoring will use only information in the LaTeX source.");
  if (config.profileDir) {
    const profile = profileEvidence(config.profileDir, data);
    data = profile.data;
    warnings.push(...profile.warnings);
  }
  const hash = createHash("sha256").update(JSON.stringify({ mainFile: config.mainFile, engine: config.engine, data }));
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) hash.update(file.name).update(file.bytes);
  return { config, files, data, warnings, version: hash.digest("hex") };
}
export function writeSnapshot(snapshot: SourcesSnapshot, directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const file of snapshot.files) {
    const path = join(directory, file.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes, { mode: 0o600 });
  }
}
