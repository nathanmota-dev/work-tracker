#!/usr/bin/env node
"use strict";

// Runs a layer's microbenchmarks sequentially and stamps the Vitest JSON report.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REPOSITORY_ROOT, assertLayer, provenancePath, stampArtifact } = require("./common.cjs");

const BENCHMARK_CONFIGS = { backend: "vitest.benchmark.config.mts", frontend: "web/vitest.benchmark.config.ts" };

function main(layer = process.argv[2]) {
  assertLayer(layer);
  const reportPath = path.join(REPOSITORY_ROOT, "reports", "benchmarks", `${layer}.json`);
  fs.rmSync(reportPath, { force: true });
  fs.rmSync(provenancePath(reportPath), { force: true });
  const result = spawnSync(
    path.join(REPOSITORY_ROOT, "node_modules", ".bin", "vitest"),
    [
      "bench",
      "--run",
      "--config",
      BENCHMARK_CONFIGS[layer],
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${reportPath}`,
    ],
    { cwd: REPOSITORY_ROOT, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status === 0) stampArtifact(reportPath, { layer, kind: "benchmark" });
  return result.status ?? 1;
}

if (require.main === module) process.exitCode = main();
