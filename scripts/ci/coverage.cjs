#!/usr/bin/env node
"use strict";

// Runs a layer's unit suite exactly once, with coverage, and stamps the summary.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { LAYERS, REPOSITORY_ROOT, assertLayer, stampArtifact } = require("./common.cjs");

const VITEST_CONFIGS = { backend: "vitest.config.mts", frontend: "web/vitest.config.ts" };

function main(layer = process.argv[2]) {
  assertLayer(layer);
  const reportsDirectory = path.join(REPOSITORY_ROOT, LAYERS[layer].coverage.reportsDirectory);
  fs.rmSync(reportsDirectory, { recursive: true, force: true });
  const result = spawnSync(
    path.join(REPOSITORY_ROOT, "node_modules", ".bin", "vitest"),
    ["run", "--coverage", "--config", VITEST_CONFIGS[layer], ...process.argv.slice(3)],
    { cwd: REPOSITORY_ROOT, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  // Only a passing suite produces a report the quality gate will accept.
  if (result.status === 0) {
    stampArtifact(path.join(reportsDirectory, "coverage-summary.json"), { layer, kind: "coverage" });
  }
  return result.status ?? 1;
}

if (require.main === module) process.exitCode = main();
