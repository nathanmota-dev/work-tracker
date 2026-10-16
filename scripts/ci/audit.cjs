#!/usr/bin/env node
"use strict";

// Audits root and workspace dependencies: critical advisories block, high ones warn.
const path = require("node:path");
const { REPOSITORY_ROOT, runCommand, writeJson } = require("./common.cjs");

function summarizeAudit(report) {
  const counts = report?.metadata?.vulnerabilities;
  if (!counts || !["critical", "high"].every((level) => Number.isInteger(counts[level]) && counts[level] >= 0)) {
    throw new Error("npm audit did not return vulnerability counts.");
  }
  return { critical: counts.critical, high: counts.high };
}

function main(layer = process.argv[2] ?? "all") {
  const result = runCommand("npm", ["audit", "--json", "--workspaces", "--include-workspace-root", "--include=dev"]);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    process.stderr.write(`npm audit returned invalid JSON (exit ${result.status}): ${result.stderr.trim()}\n`);
    return 2;
  }
  writeJson(path.join(REPOSITORY_ROOT, "reports", layer, "npm-audit.json"), report);
  let counts;
  try {
    counts = summarizeAudit(report);
  } catch (error) {
    process.stderr.write(`${error.message} ${report.error?.summary ?? ""}\n`);
    return 2;
  }
  process.stdout.write(`npm audit: ${counts.critical} critical, ${counts.high} high.\n`);
  if (counts.high > 0) {
    process.stdout.write(`::warning title=npm audit::${counts.high} high-severity advisories (warning only).\n`);
  }
  if (counts.critical > 0) {
    process.stderr.write(`::error title=npm audit::${counts.critical} critical advisories block this change.\n`);
    return 1;
  }
  return 0;
}

module.exports = { summarizeAudit };

if (require.main === module) process.exitCode = main();
