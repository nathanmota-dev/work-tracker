#!/usr/bin/env node
"use strict";

// Layer quality gate adapted from Gestão Solo: coverage floors and regressions,
// ESLint, JSCPD duplication and production file/function size limits.
const fs = require("node:fs");
const path = require("node:path");
const {
  GateInputError,
  LAYERS,
  LAYER_NAMES,
  REPOSITORY_ROOT,
  assertLayer,
  currentCommit,
  markdownEscape,
  productionFiles,
  readJson,
  runCommand,
  verifyArtifact,
  writeJson,
  writeText,
} = require("./ci/common.cjs");

const DEFAULT_BASELINE_PATH = path.join(__dirname, "quality-baseline.json");
const REPORTS_DIRECTORY = path.join(REPOSITORY_ROOT, "reports");
const COVERAGE_METRICS = ["statements", "branches", "functions", "lines"];
const DEFAULT_POLICY = Object.freeze({
  minimumCoverage: 80,
  maxFileLines: 350,
  maxFunctionLines: 100,
  duplication: Object.freeze({ minLines: 5, minTokens: 50, mode: "strict" }),
});

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GateInputError(`${label} must be an object.`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new GateInputError(`${label} must be a non-negative integer.`);
  }
}

function assertPositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new GateInputError(`${label} must be a positive number.`);
  }
}

function validateCount(count, label) {
  assertObject(count, label);
  assertNonNegativeInteger(count.covered, `${label}.covered`);
  assertNonNegativeInteger(count.total, `${label}.total`);
  if (count.covered > count.total) {
    throw new GateInputError(`${label}.covered cannot exceed ${label}.total.`);
  }
  return { covered: count.covered, total: count.total };
}

function percentage(count) {
  const { covered, total } = validateCount(count, "metric count");
  return total === 0 ? 100 : (covered / total) * 100;
}

function parseCoverageSummary(summary, label) {
  assertObject(summary, label);
  assertObject(summary.total, `${label}.total`);
  const coverage = Object.fromEntries(COVERAGE_METRICS.map((metric) => [
    metric,
    validateCount(summary.total[metric], `${label}.total.${metric}`),
  ]));
  if (coverage.statements.total === 0) {
    throw new GateInputError(`${label} is empty; no statements were measured.`);
  }
  return coverage;
}

function aggregateCoverage(coverages) {
  return Object.fromEntries(COVERAGE_METRICS.map((metric) => [
    metric,
    coverages.reduce((sum, coverage) => {
      const count = validateCount(coverage[metric], `coverage.${metric}`);
      return { covered: sum.covered + count.covered, total: sum.total + count.total };
    }, { covered: 0, total: 0 }),
  ]));
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => path.matchesGlob(file, pattern));
}

/** Files a coverage report must contain: every production file in the configured scope. */
function expectedCoverageFiles(layer, repositoryRoot = REPOSITORY_ROOT) {
  const { root, include, exclude } = LAYERS[layer].coverage;
  const prefix = root === "." ? "" : `${root}/`;
  return productionFiles(layer, repositoryRoot)
    .filter((file) => file.startsWith(prefix))
    .map((file) => file.slice(prefix.length))
    .filter((file) => matchesAny(file, include) && !matchesAny(file, exclude))
    .map((file) => `${prefix}${file}`);
}

function formatPathList(paths) {
  const shown = paths.slice(0, 10);
  return `${shown.join(", ")}${paths.length > shown.length ? `, ... (+${paths.length - shown.length} more)` : ""}`;
}

function validateCoverageScope(summary, layer, repositoryRoot = REPOSITORY_ROOT) {
  const actual = Object.keys(summary)
    .filter((key) => key !== "total")
    .map((key) => path.relative(repositoryRoot, path.resolve(repositoryRoot, key)).split(path.sep).join("/"));
  const actualSet = new Set(actual);
  const expected = expectedCoverageFiles(layer, repositoryRoot);
  const expectedSet = new Set(expected);
  const missing = expected.filter((file) => !actualSet.has(file));
  const unexpected = actual.filter((file) => !expectedSet.has(file)).sort();
  if (missing.length || unexpected.length) {
    const details = [];
    if (missing.length) details.push(`missing ${formatPathList(missing)}`);
    if (unexpected.length) details.push(`unexpected ${formatPathList(unexpected)}`);
    throw new GateInputError(`Coverage scope mismatch for ${layer}: ${details.join("; ")}.`);
  }
  return actual.length;
}

function parseEslintReport(report, layer) {
  if (!Array.isArray(report)) {
    throw new GateInputError(`ESLint report for ${layer} must be an array.`);
  }
  if (report.length === 0) {
    throw new GateInputError(`ESLint report for ${layer} did not lint any file.`);
  }
  return report.reduce((total, result, index) => {
    assertObject(result, `ESLint ${layer} result ${index}`);
    assertNonNegativeInteger(result.errorCount, `ESLint ${layer} result ${index}.errorCount`);
    assertNonNegativeInteger(result.warningCount, `ESLint ${layer} result ${index}.warningCount`);
    return total + result.errorCount + result.warningCount;
  }, 0);
}

function parseJscpdReport(report) {
  assertObject(report, "JSCPD report");
  const total = report.statistics?.total;
  assertObject(total, "JSCPD report total statistics");
  const totalLines = total.lines;
  const duplicatedLines = total.duplicatedLines;
  const fragments = total.clones ?? (Array.isArray(report.duplicates) ? report.duplicates.length : undefined);
  assertNonNegativeInteger(totalLines, "JSCPD total lines");
  assertNonNegativeInteger(duplicatedLines, "JSCPD duplicated lines");
  assertNonNegativeInteger(fragments, "JSCPD clone fragments");
  if (duplicatedLines > totalLines) {
    throw new GateInputError("JSCPD duplicated lines cannot exceed total lines.");
  }
  if (!Number.isFinite(total.percentage) || total.percentage < 0) {
    throw new GateInputError("JSCPD duplication percentage must be a non-negative number.");
  }
  const computed = totalLines === 0 ? 0 : (duplicatedLines / totalLines) * 100;
  if (Math.abs(total.percentage - computed) > 0.02) {
    throw new GateInputError(
      `JSCPD percentage (${total.percentage}) is inconsistent with duplicated/total lines (${computed.toFixed(2)}).`,
    );
  }
  return { duplicatedLines, totalLines, fragments };
}

function countPhysicalLines(contents) {
  if (contents.length === 0) return 0;
  const normalized = contents.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").length;
  return normalized.endsWith("\n") ? lines - 1 : lines;
}

function isFunctionNode(ts, node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isArrowFunction(node);
}

function functionDisplayName(ts, node, sourceFile) {
  if (node.name) return node.name.getText(sourceFile);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return parent.name.getText(sourceFile);
  if (ts.isCallExpression(parent)) return `callback of ${parent.expression.getText(sourceFile).slice(0, 40)}`;
  return "anonymous";
}

/** Every function-like body, including nested callbacks and arrow functions. */
function scanFunctionSizes(contents, filePath, ts = require("typescript")) {
  const scriptKind = /\.(tsx|jsx)$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true, scriptKind);
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const position = sourceFile.getLineAndCharacterOfPosition(diagnostics[0].start ?? 0);
    const message = ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ");
    throw new GateInputError(`Could not parse ${filePath}:${position.line + 1}: ${message}`);
  }
  const functions = [];
  (function visit(node) {
    if (isFunctionNode(ts, node) && node.body) {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      functions.push({ filePath, name: functionDisplayName(ts, node, sourceFile), startLine, lineCount: endLine - startLine + 1 });
    }
    ts.forEachChild(node, visit);
  })(sourceFile);
  return functions;
}

function collectSizes(layer, policy, repositoryRoot = REPOSITORY_ROOT) {
  const oversizedFiles = [];
  const oversizedFunctions = [];
  const files = productionFiles(layer, repositoryRoot);
  for (const file of files) {
    const contents = fs.readFileSync(path.join(repositoryRoot, file), "utf8");
    const lines = countPhysicalLines(contents);
    if (lines > policy.maxFileLines) oversizedFiles.push({ filePath: file, lineCount: lines });
    oversizedFunctions.push(...scanFunctionSizes(contents, file)
      .filter((item) => item.lineCount > policy.maxFunctionLines));
  }
  return { scannedFiles: files.length, oversizedFiles, oversizedFunctions };
}

function generateJscpdReport(layer, policy) {
  const binary = path.join(REPOSITORY_ROOT, "node_modules", ".bin", process.platform === "win32" ? "jscpd.cmd" : "jscpd");
  if (!fs.existsSync(binary)) {
    throw new GateInputError(`JSCPD is not installed at ${binary}. Run npm ci first.`);
  }
  const outputDirectory = path.join(REPORTS_DIRECTORY, layer, "jscpd");
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  const { minLines, minTokens, mode } = policy.duplication;
  const result = runCommand(binary, [
    ...productionFiles(layer),
    "--min-lines", String(minLines),
    "--min-tokens", String(minTokens),
    "--mode", mode,
    "--reporters", "json",
    "--output", outputDirectory,
    "--no-colors",
  ]);
  writeText(path.join(outputDirectory, "console.txt"), `${result.stdout}${result.stderr}`);
  if (result.status !== 0) {
    throw new GateInputError(`JSCPD failed for ${layer} (exit ${result.status}): ${(result.stderr || result.stdout).trim()}`);
  }
  return readJson(path.join(outputDirectory, "jscpd-report.json"), `${layer} JSCPD report`);
}

function validatePolicy(policy) {
  assertObject(policy, "baseline.policy");
  assertPositiveNumber(policy.minimumCoverage, "baseline.policy.minimumCoverage");
  if (policy.minimumCoverage > 100) {
    throw new GateInputError("baseline.policy.minimumCoverage cannot exceed 100.");
  }
  assertNonNegativeInteger(policy.maxFileLines, "baseline.policy.maxFileLines");
  assertNonNegativeInteger(policy.maxFunctionLines, "baseline.policy.maxFunctionLines");
  assertObject(policy.duplication, "baseline.policy.duplication");
  assertNonNegativeInteger(policy.duplication.minLines, "baseline.policy.duplication.minLines");
  assertNonNegativeInteger(policy.duplication.minTokens, "baseline.policy.duplication.minTokens");
  if (!["mild", "weak", "strict"].includes(policy.duplication.mode)) {
    throw new GateInputError("baseline.policy.duplication.mode must be mild, weak or strict.");
  }
  return policy;
}

function validateLayerMetrics(metrics, label) {
  assertObject(metrics, label);
  assertObject(metrics.coverage, `${label}.coverage`);
  for (const metric of COVERAGE_METRICS) validateCount(metrics.coverage[metric], `${label}.coverage.${metric}`);
  assertObject(metrics.duplication, `${label}.duplication`);
  validateCount(
    { covered: metrics.duplication.duplicatedLines, total: metrics.duplication.totalLines },
    `${label}.duplication lines`,
  );
  assertNonNegativeInteger(metrics.duplication.fragments, `${label}.duplication.fragments`);
  assertObject(metrics.violations, `${label}.violations`);
  for (const key of ["lint", "oversizedFiles", "oversizedFunctions"]) {
    assertNonNegativeInteger(metrics.violations[key], `${label}.violations.${key}`);
  }
  return metrics;
}

function validateBaseline(baseline) {
  assertObject(baseline, "baseline");
  if (baseline.schemaVersion !== 1) {
    throw new GateInputError(`Unsupported baseline schemaVersion: ${baseline.schemaVersion}`);
  }
  validatePolicy(baseline.policy);
  assertObject(baseline.layers, "baseline.layers");
  for (const layer of LAYER_NAMES) validateLayerMetrics(baseline.layers[layer], `baseline.layers.${layer}`);
  return baseline;
}

function collectLayerMetrics(layer, policy) {
  const summaryPath = path.join(REPOSITORY_ROOT, LAYERS[layer].coverage.reportsDirectory, "coverage-summary.json");
  verifyArtifact(summaryPath, { layer, kind: "coverage", label: `${layer} coverage summary` });
  const summary = readJson(summaryPath, `${layer} coverage summary`);
  const coverage = parseCoverageSummary(summary, `${layer} coverage summary`);
  const coverageFiles = validateCoverageScope(summary, layer);
  const eslintPath = path.join(REPORTS_DIRECTORY, layer, "eslint.json");
  verifyArtifact(eslintPath, { layer, kind: "eslint", label: `${layer} ESLint report` });
  const lint = parseEslintReport(readJson(eslintPath, `${layer} ESLint report`), layer);
  const duplication = parseJscpdReport(generateJscpdReport(layer, policy));
  const sizes = collectSizes(layer, policy);
  return {
    coverage,
    duplication,
    violations: {
      lint,
      oversizedFiles: sizes.oversizedFiles.length,
      oversizedFunctions: sizes.oversizedFunctions.length,
    },
    details: { coverageFiles, scannedFiles: sizes.scannedFiles, ...sizes },
  };
}

function ratioIsLower(current, baseline) {
  const now = validateCount(current, "current ratio");
  const before = validateCount(baseline, "baseline ratio");
  if (now.total === 0) return before.total > 0;
  if (before.total === 0) return now.covered !== now.total;
  return now.covered * before.total < before.covered * now.total;
}

function duplicationRatioIsHigher(current, baseline) {
  if (current.totalLines === 0) return false;
  if (baseline.totalLines === 0) return current.duplicatedLines > 0;
  return current.duplicatedLines * baseline.totalLines > baseline.duplicatedLines * current.totalLines;
}

function formatPercentage(value) {
  return `${(Math.floor((value + Number.EPSILON) * 100) / 100).toFixed(2)}%`;
}

function duplicationPercentage(value) {
  return value.totalLines === 0 ? 0 : (value.duplicatedLines / value.totalLines) * 100;
}

function compareLayer(layer, baselineLayer, current, policy) {
  validateLayerMetrics(baselineLayer, `baseline.layers.${layer}`);
  const failures = [];
  for (const metric of COVERAGE_METRICS) {
    const value = percentage(current.coverage[metric]);
    if (current.coverage[metric].covered * 100 < current.coverage[metric].total * policy.minimumCoverage) {
      failures.push(`${layer} ${metric} coverage is ${formatPercentage(value)}, below the ${policy.minimumCoverage}% floor.`);
    }
    if (ratioIsLower(current.coverage[metric], baselineLayer.coverage[metric])) {
      failures.push(
        `${layer} ${metric} coverage decreased from ${formatPercentage(percentage(baselineLayer.coverage[metric]))} to ${formatPercentage(value)}.`,
      );
    }
  }
  if (current.duplication.totalLines === 0 && baselineLayer.duplication.totalLines > 0) {
    failures.push(`${layer} duplication report is empty; the baseline scanned ${baselineLayer.duplication.totalLines} lines.`);
  } else if (duplicationRatioIsHigher(current.duplication, baselineLayer.duplication)) {
    failures.push(
      `${layer} duplication increased from ${formatPercentage(duplicationPercentage(baselineLayer.duplication))} to ${formatPercentage(duplicationPercentage(current.duplication))}.`,
    );
  }
  if (current.duplication.fragments > baselineLayer.duplication.fragments) {
    failures.push(`${layer} duplicate fragments increased from ${baselineLayer.duplication.fragments} to ${current.duplication.fragments}.`);
  }
  if (current.violations.lint > 0) {
    failures.push(`${layer} has ${current.violations.lint} ESLint error(s) or warning(s); zero are allowed.`);
  }
  if (current.violations.oversizedFiles > 0) {
    failures.push(`${layer} has ${current.violations.oversizedFiles} production file(s) over ${policy.maxFileLines} lines.`);
  }
  if (current.violations.oversizedFunctions > 0) {
    failures.push(`${layer} has ${current.violations.oversizedFunctions} function(s) over ${policy.maxFunctionLines} lines.`);
  }
  for (const file of current.details?.oversizedFiles ?? []) {
    failures.push(`${file.filePath} has ${file.lineCount} lines.`);
  }
  for (const item of current.details?.oversizedFunctions ?? []) {
    failures.push(`${item.filePath}:${item.startLine} ${item.name} has ${item.lineCount} lines.`);
  }
  return failures;
}

function snapshotLayer(metrics) {
  return {
    coverage: Object.fromEntries(COVERAGE_METRICS.map((metric) => [metric, { ...metrics.coverage[metric] }])),
    duplication: { ...metrics.duplication },
    violations: { ...metrics.violations },
  };
}

function buildBaseline(layers, policy, generatedFromCommit = "unknown") {
  return {
    schemaVersion: 1,
    generatedFromCommit,
    policy: JSON.parse(JSON.stringify(policy)),
    layers: Object.fromEntries(Object.entries(layers).map(([layer, metrics]) => [layer, snapshotLayer(metrics)])),
  };
}

function formatCoverage(count) {
  return count.total === 0 ? "No data" : formatPercentage(percentage(count));
}

function formatDelta(current, baseline) {
  if (current.total === 0 || baseline.total === 0) return "n/a";
  const difference = percentage(current) - percentage(baseline);
  if (difference !== 0 && Math.abs(difference) < 0.005) return `${difference > 0 ? "+" : "-"}<0.01 pp`;
  return `${difference >= 0 ? "+" : ""}${difference.toFixed(2)} pp`;
}

function renderMarkdown({ baseline, results, failures, baselineLabel }) {
  const passed = failures.length === 0;
  const layers = Object.keys(results);
  const lines = [
    `# Quality Gate (${layers.join(", ")})`,
    "",
    `**${passed ? "PASS" : "FAIL"}** — ${passed ? "No quality regression detected." : `${failures.length} problem(s) detected.`}`,
    "",
    `Baseline: \`${markdownEscape(baselineLabel)}\` (commit \`${markdownEscape(baseline.generatedFromCommit ?? "unknown")}\`) · coverage floor: ${baseline.policy.minimumCoverage}% per metric.`,
    "",
  ];
  if (!passed) lines.push("## Failures", "", ...failures.map((failure) => `- ${markdownEscape(failure)}`), "");
  lines.push("## Coverage", "", "| Layer | Metric | Baseline | Current | Change |", "|---|---|---:|---:|---:|");
  const rows = layers.map((layer) => [layer, baseline.layers[layer].coverage, results[layer].coverage]);
  if (layers.length === LAYER_NAMES.length) {
    rows.push([
      "weighted total",
      aggregateCoverage(LAYER_NAMES.map((layer) => baseline.layers[layer].coverage)),
      aggregateCoverage(LAYER_NAMES.map((layer) => results[layer].coverage)),
    ]);
  }
  for (const [label, before, now] of rows) {
    for (const metric of COVERAGE_METRICS) {
      lines.push(`| ${label} | ${metric} | ${formatCoverage(before[metric])} | ${formatCoverage(now[metric])} | ${formatDelta(now[metric], before[metric])} |`);
    }
  }
  lines.push(
    "",
    "## Duplication and limits",
    "",
    "| Layer | Duplication | Fragments | ESLint problems | Files > limit | Functions > limit |",
    "|---|---:|---:|---:|---:|---:|",
  );
  for (const layer of layers) {
    const before = baseline.layers[layer];
    const now = results[layer];
    lines.push(
      `| ${layer} | ${formatPercentage(duplicationPercentage(now.duplication))} (baseline ${formatPercentage(duplicationPercentage(before.duplication))}) | ${now.duplication.fragments} (baseline ${before.duplication.fragments}) | ${now.violations.lint} | ${now.violations.oversizedFiles} | ${now.violations.oversizedFunctions} |`,
    );
  }
  lines.push("", "## Diagnostics", "");
  for (const layer of layers) {
    const details = results[layer].details ?? {};
    lines.push(
      `- ${layer}: ${details.coverageFiles ?? "?"} covered files, ${details.scannedFiles ?? "?"} production files scanned, ${results[layer].duplication.duplicatedLines}/${results[layer].duplication.totalLines} duplicated lines.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArguments(args) {
  const options = {
    layers: [],
    updateBaseline: false,
    baselinePath: process.env.QUALITY_GATE_BASELINE_PATH || DEFAULT_BASELINE_PATH,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--update-baseline") {
      options.updateBaseline = true;
    } else if (argument === "--layer") {
      const value = args[++index];
      if (!value) throw new GateInputError("--layer requires backend or frontend.");
      options.layers.push(assertLayer(value));
    } else if (argument === "--baseline") {
      const value = args[++index];
      if (!value) throw new GateInputError("--baseline requires a path.");
      options.baselinePath = path.resolve(REPOSITORY_ROOT, value);
    } else {
      throw new GateInputError(`Unknown argument: ${argument}`);
    }
  }
  if (!options.layers.length) options.layers = [...LAYER_NAMES];
  options.layers = [...new Set(options.layers)];
  return options;
}

function reportPaths(layers) {
  const directory = layers.length === 1 ? path.join(REPORTS_DIRECTORY, layers[0]) : REPORTS_DIRECTORY;
  return {
    markdown: path.join(directory, "quality-gate.md"),
    json: path.join(directory, "quality-gate.json"),
    candidate: path.join(directory, "quality-candidate-baseline.json"),
  };
}

function writeErrorReport(layers, error) {
  const paths = reportPaths(layers);
  writeText(paths.markdown, `# Quality Gate (${layers.join(", ")})\n\n**ERROR** — Metrics could not be collected or validated.\n\n## Failure\n\n- ${markdownEscape(error.message)}\n`);
  writeJson(paths.json, { schemaVersion: 1, status: "error", layers, error: error.message });
}

function runCli(args = process.argv.slice(2)) {
  let layers = [...LAYER_NAMES];
  try {
    const options = parseArguments(args);
    layers = options.layers;
    if (options.updateBaseline && process.env.CI === "true") {
      throw new GateInputError("Baseline updates are disabled in CI.");
    }
    if (options.updateBaseline && layers.length !== LAYER_NAMES.length) {
      throw new GateInputError("Updating the quality baseline requires both layers.");
    }
    const existing = fs.existsSync(options.baselinePath)
      ? validateBaseline(readJson(options.baselinePath, "quality baseline"))
      : null;
    if (!existing && !options.updateBaseline) {
      throw new GateInputError(`Quality baseline not found at ${options.baselinePath}. Run with --update-baseline locally.`);
    }
    const policy = existing?.policy ?? DEFAULT_POLICY;
    const results = Object.fromEntries(layers.map((layer) => [layer, collectLayerMetrics(layer, policy)]));
    const candidate = buildBaseline(
      { ...(existing?.layers ?? {}), ...results },
      policy,
      currentCommit().slice(0, 12),
    );
    const baseline = options.updateBaseline ? candidate : existing;
    const failures = layers.flatMap((layer) => compareLayer(layer, baseline.layers[layer], results[layer], policy));
    const baselineLabel = options.updateBaseline
      ? path.relative(REPOSITORY_ROOT, options.baselinePath)
      : process.env.QUALITY_GATE_BASELINE_LABEL || path.relative(REPOSITORY_ROOT, options.baselinePath);
    const markdown = renderMarkdown({ baseline, results, failures, baselineLabel });
    const paths = reportPaths(layers);
    writeJson(paths.candidate, candidate);
    writeText(paths.markdown, markdown);
    writeJson(paths.json, {
      schemaVersion: 1,
      status: failures.length ? "fail" : "pass",
      layers,
      baseline: { label: baselineLabel, generatedFromCommit: baseline.generatedFromCommit },
      results,
      failures,
    });
    process.stdout.write(markdown);
    if (options.updateBaseline) {
      if (failures.length) {
        process.stderr.write("Baseline not updated: the current metrics fail the absolute quality policy.\n");
        return 1;
      }
      writeJson(options.baselinePath, candidate);
      process.stdout.write(`Baseline updated: ${path.relative(REPOSITORY_ROOT, options.baselinePath)}\n`);
    }
    return failures.length ? 1 : 0;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    writeErrorReport(layers, normalized);
    process.stderr.write(`${normalized.name}: ${normalized.message}\n`);
    return 2;
  }
}

module.exports = {
  COVERAGE_METRICS,
  DEFAULT_POLICY,
  aggregateCoverage,
  buildBaseline,
  compareLayer,
  countPhysicalLines,
  duplicationRatioIsHigher,
  expectedCoverageFiles,
  parseArguments,
  parseCoverageSummary,
  parseEslintReport,
  parseJscpdReport,
  ratioIsLower,
  renderMarkdown,
  runCli,
  scanFunctionSizes,
  validateBaseline,
  validateCoverageScope,
};

if (require.main === module) process.exitCode = runCli();
