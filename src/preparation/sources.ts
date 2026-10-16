import { parse } from "@babel/parser";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, join, dirname } from "node:path";
import { loadConfig, saveConfig } from "../paths.ts";
import type { ResumeSourcesConfig } from "./types.ts";

export class PreparationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function isFile(path: string): boolean {
  try { return statSync(path).isFile(); }
  catch { return false; }
}
export function sourcesConfig(): ResumeSourcesConfig {
  const saved = loadConfig().resumeSources;
  if (saved?.projectDir) return saved;
  // The installed desktop app supplies its build checkout; the CLI uses its cwd.
  // Only real local inputs are defaults: the versioned examples require filling in.
  const root = resolve(process.env.WORK_TRACKER_REPO_ROOT ?? process.cwd());
  const projectDir = join(root, "base", "latex");
  if (isFile(join(projectDir, "resume.tex"))) {
    const dataFile = ["resume-data.json", "resume-data.ts"]
      .map(name => join(root, "base", "data", name)).find(isFile) ?? "";
    return { projectDir, mainFile: "resume.tex", dataFile, engine: "pdflatex" };
  }
  return { projectDir: "", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" };
}
export function saveSources(body: unknown): ResumeSourcesConfig {
  if (!body || typeof body !== "object") throw new PreparationError("Expected resume source settings.");
  const value = body as Record<string, unknown>;
  if (!["projectDir", "mainFile", "dataFile", "engine"].every(key => typeof value[key] === "string")) throw new PreparationError("Enter the project folder, main file and compiler.");
  const config = { projectDir: String(value.projectDir).trim(), mainFile: String(value.mainFile).trim(), dataFile: String(value.dataFile).trim(), engine: value.engine } as ResumeSourcesConfig;
  if (!["pdflatex", "xelatex", "lualatex"].includes(config.engine)) throw new PreparationError("Unknown LaTeX compiler.");
  snapshotSources(config);
  saveConfig({ ...loadConfig(), resumeSources: config });
  return config;
}
type LiteralNode = {
  type: string;
  value?: unknown;
  expression?: LiteralNode;
  elements?: LiteralNode[];
  properties?: { type: string; computed?: boolean; method?: boolean; key: { name?: string; value?: unknown }; value: LiteralNode }[];
};
function literal(node: unknown): unknown {
  const n = node as LiteralNode | undefined;
  if (!n) throw new PreparationError("Missing resume data.");
  if (["TSAsExpression", "TSSatisfiesExpression"].includes(n.type)) return literal(n.expression);
  if (["StringLiteral", "NumericLiteral", "BooleanLiteral"].includes(n.type)) return n.value;
  if (n.type === "NullLiteral") return null;
  if (n.type === "ArrayExpression") return (n.elements ?? []).map(literal);
  if (n.type === "ObjectExpression") {
    const result: Record<string, unknown> = {};
    for (const property of n.properties ?? []) {
      if (property.type !== "ObjectProperty" || property.computed || property.method) throw new PreparationError("Resume data must contain only literal properties.");
      const key = property.key.name ?? property.key.value;
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) throw new PreparationError("Unsupported resume property.");
      result[key] = literal(property.value);
    }
    return result;
  }
  throw new PreparationError("Resume data must be a static object. Imports, functions and executable expressions are not supported.");
}
export function parseResumeData(text: string, extension: string): Record<string, unknown> {
  let value: unknown;
  try {
    if (extension === ".json") value = JSON.parse(text);
    else if (extension === ".ts") {
      const ast = parse(text, { sourceType: "module", plugins: ["typescript"] });
      const statements = ast.program.body;
      if (statements.length !== 1 || statements[0]?.type !== "ExportNamedDeclaration" || statements[0].declaration?.type !== "VariableDeclaration") throw new PreparationError("Export a single constant RESUME_DATA object.");
      const declarations = statements[0].declaration.declarations;
      if (declarations.length !== 1 || declarations[0]?.id.type !== "Identifier" || declarations[0].id.name !== "RESUME_DATA" || statements[0].declaration.kind !== "const") throw new PreparationError("Export a single constant RESUME_DATA object.");
      value = literal(declarations[0].init);
    } else throw new PreparationError("Choose a .json or .ts resume data file.");
  } catch (error) {
    if (error instanceof PreparationError) throw error;
    throw new PreparationError(`Invalid resume data: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PreparationError("Resume data must be an object.");
  const result = value as Record<string, unknown>;
  for (const key of ["education", "work", "projects", "skills", "techStack"]) {
    if (result[key] !== undefined && !Array.isArray(result[key])) throw new PreparationError(`${key} must be an array.`);
  }
  const aliases: Record<string, string> = { Node: "Node.js", Next: "Next.js", NextJs: "Next.js", ReactJs: "React", PostrgreSQL: "PostgreSQL", TailwindCSS: "Tailwind CSS", "Amazon S3": "AWS S3", "Amazon EC2": "AWS EC2" };
  const libraries = /^(shadcn[./]ui|nextauth|three\.js|react-icons|@next\/mdx|styled-components|remixicon|swiperjs|scrollreveal|next-intl|framer(?: motion)?)$/i;
  function normalize(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    for (const [key, entry] of Object.entries(obj)) {
      if (["skills", "techStack"].includes(key) && Array.isArray(entry)) {
        if (!entry.every(item => typeof item === "string")) throw new PreparationError(`${key} must contain technology names.`);
        (obj as Record<string, unknown>)[key] = [...new Set(entry.map(item => aliases[item] ?? item.trim()).filter(item => item && !libraries.test(item)))];
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
