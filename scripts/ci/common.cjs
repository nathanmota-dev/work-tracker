"use strict";

// Shared helpers for the layer quality and performance gates.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const LAYERS = require("./layers.json");
const LAYER_NAMES = Object.keys(LAYERS);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

class GateInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "GateInputError";
  }
}

function assertLayer(layer) {
  if (!LAYER_NAMES.includes(layer)) {
    throw new GateInputError(`Unknown layer: ${layer}. Expected ${LAYER_NAMES.join(" or ")}.`);
  }
  return layer;
}

function readJson(filePath, label = filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new GateInputError(`Could not read ${label} at ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new GateInputError(`${label} is not valid JSON: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isTestFile(relativePath) {
  return /(^|\/)(__tests__|test)(\/|$)/.test(relativePath)
    || /\.(test|spec|bench)\.[^/]+$/.test(relativePath);
}

function isDeclarationFile(relativePath) {
  return /\.d\.(ts|mts|cts)$/.test(relativePath);
}

function isGeneratedFile(relativePath) {
  return /\.gen\.[^/]+$/.test(relativePath);
}

function walkFiles(root, repositoryRoot = REPOSITORY_ROOT) {
  const absoluteRoot = path.resolve(repositoryRoot, root);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new GateInputError(`Source root does not exist: ${root}`);
  }
  const files = [];
  (function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || entry.name === "node_modules") continue;
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(toPosix(path.relative(repositoryRoot, absolutePath)));
    }
  })(absoluteRoot);
  return files;
}

/** Production source files of a layer: no tests, benchmarks, declarations or generated code. */
function productionFiles(layer, repositoryRoot = REPOSITORY_ROOT) {
  return LAYERS[assertLayer(layer)].sourceRoots
    .flatMap((root) => walkFiles(root, repositoryRoot))
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file))
      && !isTestFile(file)
      && !isDeclarationFile(file)
      && !isGeneratedFile(file))
    .sort((left, right) => left.localeCompare(right));
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  if (result.error) {
    throw new GateInputError(`Could not run ${command}: ${result.error.message}`);
  }
  return result;
}

function currentCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function digestFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Digest of every file under the layer roots, so local reports go stale after edits. */
function sourceDigest(layer) {
  const hash = crypto.createHash("sha256");
  const files = [...LAYERS[assertLayer(layer)].sourceRoots.flatMap((root) => walkFiles(root)), "scripts/ci/layers.json"];
  for (const file of files.sort()) {
    hash.update(file).update("\0").update(fs.readFileSync(path.join(REPOSITORY_ROOT, file))).update("\0");
  }
  return hash.digest("hex");
}

function runIdentity(layer) {
  return {
    commit: currentCommit(),
    runId: process.env.GITHUB_RUN_ID || "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "local",
    sourceDigest: sourceDigest(layer),
  };
}

function provenancePath(filePath) {
  return `${filePath}.provenance.json`;
}

/** Records which run, commit and sources produced a report so gates can reject foreign files. */
function stampArtifact(filePath, { layer, kind }) {
  writeJson(provenancePath(filePath), {
    schemaVersion: 1,
    layer,
    kind,
    ...runIdentity(layer),
    sha256: digestFile(filePath),
  });
}

function verifyArtifact(filePath, { layer, kind, label }) {
  if (!fs.existsSync(filePath)) {
    throw new GateInputError(`${label} is missing at ${toPosix(path.relative(REPOSITORY_ROOT, filePath))}.`);
  }
  const provenance = readJson(provenancePath(filePath), `${label} provenance`);
  const expected = { schemaVersion: 1, layer, kind, ...runIdentity(layer), sha256: digestFile(filePath) };
  for (const [key, value] of Object.entries(expected)) {
    if (provenance[key] !== value) {
      throw new GateInputError(
        `${label} was not produced by this run for the current sources (${key}: expected ${value}, found ${provenance[key]}).`,
      );
    }
  }
  return provenance;
}

function markdownEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "&#64;")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/\r?\n/g, " ");
}

function resolveFromRoot(value) {
  return path.resolve(REPOSITORY_ROOT, value);
}

module.exports = {
  GateInputError,
  LAYERS,
  LAYER_NAMES,
  REPOSITORY_ROOT,
  assertLayer,
  currentCommit,
  digestFile,
  isDeclarationFile,
  isGeneratedFile,
  isTestFile,
  markdownEscape,
  productionFiles,
  provenancePath,
  readJson,
  resolveFromRoot,
  runCommand,
  stampArtifact,
  toPosix,
  verifyArtifact,
  walkFiles,
  writeJson,
  writeText,
};
