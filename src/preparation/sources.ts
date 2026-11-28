import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, join, dirname } from "node:path";
import { loadConfig, paths, saveConfig } from "../paths.ts";
import type { ResumeSourcesConfig } from "./types.ts";
import { profileEvidence } from "../profile/evidence.ts";
import { PreparationError, parseResumeData } from "./resume-data.ts";
export { PreparationError, parseResumeData };

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); }
  catch { return false; }
}
/** The LaTeX settings; the profile is always the app's own folder, which uploads fill. */
export function sourcesConfig(): ResumeSourcesConfig {
  const saved = loadConfig().resumeSources;
  const latex = saved?.projectDir ? { projectDir: saved.projectDir, mainFile: saved.mainFile, engine: saved.engine } : detectedLatex();
  return { ...latex, dataFile: "", profileDir: paths.profile };
}
function detectedLatex(): Pick<ResumeSourcesConfig, "projectDir" | "mainFile" | "engine"> {
  // The installed desktop app supplies its build checkout; the CLI uses its cwd.
  // Only a real local resume is a default: the versioned example requires filling in.
  const root = resolve(process.env.WORK_TRACKER_REPO_ROOT ?? process.cwd());
  const projectDir = join(root, "base", "latex");
  return { projectDir: isFile(join(projectDir, "resume.tex")) ? projectDir : "", mainFile: "resume.tex", engine: "pdflatex" };
}
export function saveSources(body: unknown): ResumeSourcesConfig {
  if (!body || typeof body !== "object") throw new PreparationError("Expected resume source settings.");
  const value = body as Record<string, unknown>;
  if (!["projectDir", "mainFile", "engine"].every(key => typeof value[key] === "string")) throw new PreparationError("Enter the project folder, main file and compiler.");
  const config: ResumeSourcesConfig = { projectDir: String(value.projectDir).trim(), mainFile: String(value.mainFile).trim(), engine: value.engine as ResumeSourcesConfig["engine"], dataFile: "", profileDir: paths.profile };
  if (!["pdflatex", "xelatex", "lualatex"].includes(config.engine)) throw new PreparationError("Unknown LaTeX compiler.");
  snapshotSources(config);
  saveConfig({ ...loadConfig(), resumeSources: config });
  return config;
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
  if (config.profileDir) {
    const profile = profileEvidence(config.profileDir);
    data = profile.data;
    warnings.push(...profile.warnings);
    if (!profile.source) warnings.push("Upload your resume data or LinkedIn PDF in Profile. Tailoring will use only information in the LaTeX source.");
  } else if (config.dataFile) {
    // A batch's recorded copy of the profile.
    if (!isAbsolute(config.dataFile) || !existsSync(config.dataFile)) throw new PreparationError("The recorded resume data no longer exists.");
    data = parseResumeData(readFileSync(config.dataFile, "utf8"), ".json");
  }
  for (const key of ["projects", "work"]) {
    const entries = data?.[key] as Record<string, unknown>[] | undefined;
    if (entries?.some(item => !item || typeof item !== "object" || (item.hidden !== true && !item.description && !item.highlights))) warnings.push(`Some ${key} entries have no descriptions. The agent can use only evidence available in the template and data.`);
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
