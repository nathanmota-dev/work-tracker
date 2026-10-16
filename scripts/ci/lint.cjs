#!/usr/bin/env node
"use strict";

// Lints a layer with a content-based cache and records a JSON report for the quality gate.
const path = require("node:path");
const { ESLint } = require("eslint");
const { LAYERS, REPOSITORY_ROOT, assertLayer, stampArtifact, writeJson } = require("./common.cjs");

async function main(layer = process.argv[2]) {
  assertLayer(layer);
  const eslint = new ESLint({
    cwd: REPOSITORY_ROOT,
    cache: true,
    cacheStrategy: "content",
    cacheLocation: path.join(REPOSITORY_ROOT, ".cache", "work-tracker", layer, "eslint", ".eslintcache"),
  });
  const results = await eslint.lintFiles(LAYERS[layer].lintTargets);
  const report = results.map(({ filePath, errorCount, warningCount, fatalErrorCount, messages }) => ({
    filePath: path.relative(REPOSITORY_ROOT, filePath),
    errorCount,
    warningCount,
    fatalErrorCount,
    messages: messages.map(({ ruleId, severity, message, line, column }) => ({ ruleId, severity, message, line, column })),
  }));
  const reportPath = path.join(REPOSITORY_ROOT, "reports", layer, "eslint.json");
  writeJson(reportPath, report);
  stampArtifact(reportPath, { layer, kind: "eslint" });
  const formatter = await eslint.loadFormatter("stylish");
  const output = await formatter.format(results);
  if (output) process.stdout.write(output);
  const problems = results.reduce((total, result) => total + result.errorCount + result.warningCount, 0);
  process.stdout.write(`ESLint ${layer}: ${results.length} files, ${problems} problem(s).\n`);
  return problems === 0 ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }, (error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 2;
  });
}
