#!/usr/bin/env node
"use strict";

// Chooses which benchmark layers a pull request must measure from its changed files.
// Usage: node scripts/ci/benchmark-layers.cjs <base-sha> <head-sha>  (prints GitHub step outputs)
const { spawnSync } = require("node:child_process");
const { REPOSITORY_ROOT } = require("./common.cjs");

// Files read by both layers' benchmarks, plus the tooling that measures and judges them.
const SHARED_FILES = new Set([
  "src/applications/types.ts",
  "src/preparation/types.ts",
  "src/jobs/search-results.ts",
  "src/jobs/identity.ts",
  "package.json",
  "package-lock.json",
  ".github/workflows/performance.yml",
]);
const SHARED_PREFIXES = ["scripts/benchmark-gate", "scripts/ci/"];
const BACKEND_PREFIXES = ["src/", "desktop/", "benchmarks/"];
const BACKEND_FILES = new Set(["vitest.benchmark.config.mts"]);

function selectLayers(files) {
  let backend = false;
  let frontend = false;
  for (const file of files) {
    if (SHARED_FILES.has(file) || SHARED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      backend = true;
      frontend = true;
    } else if (file.startsWith("web/")) {
      frontend = true;
    } else if (BACKEND_FILES.has(file) || BACKEND_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      backend = true;
    }
  }
  const layers = [backend && "backend", frontend && "frontend"].filter(Boolean);
  return { backend, frontend, layers };
}

function changedFiles(base, head) {
  const result = spawnSync("git", ["diff", "--no-renames", "--name-only", base, head], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git diff failed: ${result.stderr.trim()}`);
  return result.stdout.split("\n").filter(Boolean);
}

function main([base, head] = process.argv.slice(2)) {
  if (!base || !head) {
    process.stderr.write("Usage: benchmark-layers.cjs <base-sha> <head-sha>\n");
    return 2;
  }
  const { backend, frontend, layers } = selectLayers(changedFiles(base, head));
  process.stdout.write(`backend=${backend}\nfrontend=${frontend}\nlayers=${layers.join(",")}\n`);
  return 0;
}

module.exports = { selectLayers };

if (require.main === module) process.exitCode = main();
