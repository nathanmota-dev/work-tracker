"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, afterEach, describe, it } = require("node:test");
const gate = require("./quality-gate.cjs");
const common = require("./ci/common.cjs");

const POLICY = { ...gate.DEFAULT_POLICY, duplication: { ...gate.DEFAULT_POLICY.duplication } };
function coverage(covered, total = 100) {
  return Object.fromEntries(gate.COVERAGE_METRICS.map((metric) => [metric, { covered, total }]));
}
function layer(overrides = {}) {
  return {
    coverage: coverage(90),
    duplication: { duplicatedLines: 10, totalLines: 1000, fragments: 2 },
    violations: { lint: 0, oversizedFiles: 0, oversizedFunctions: 0 },
    ...overrides,
  };
}
function baseline(overrides = {}) {
  return { schemaVersion: 1, generatedFromCommit: "abc", policy: POLICY, layers: { backend: layer(), frontend: layer() }, ...overrides };
}

describe("coverage", () => {
  it("passes at the floor and blocks values below 80%", () => {
    assert.deepEqual(gate.compareLayer("frontend", layer({ coverage: coverage(80) }), layer({ coverage: coverage(80) }), POLICY), []);
    const failures = gate.compareLayer("frontend", layer({ coverage: coverage(70) }), layer({ coverage: coverage(79) }), POLICY);
    assert.equal(failures.filter((item) => item.includes("below the 80% floor")).length, 4);
  });

  it("blocks any regression from the baseline, even above the floor", () => {
    const failures = gate.compareLayer("backend", layer({ coverage: coverage(95) }), layer({ coverage: coverage(94) }), POLICY);
    assert.equal(failures.length, 4);
    assert.match(failures[0], /backend statements coverage decreased from 95.00% to 94.00%/);
  });

  it("compares ratios instead of rounded percentages", () => {
    assert.equal(gate.ratioIsLower({ covered: 199, total: 200 }, { covered: 99, total: 100 }), false);
    assert.equal(gate.ratioIsLower({ covered: 1989, total: 2000 }, { covered: 995, total: 1000 }), true);
    assert.equal(gate.ratioIsLower({ covered: 0, total: 0 }, { covered: 1, total: 1 }), true);
  });

  it("rejects malformed and empty coverage summaries", () => {
    assert.throws(() => gate.parseCoverageSummary({}, "summary"), /summary.total must be an object/);
    assert.throws(() => gate.parseCoverageSummary({ total: coverage(0, 0) }, "summary"), /is empty/);
    assert.throws(() => gate.parseCoverageSummary({ total: coverage(5, 4) }, "summary"), /cannot exceed/);
  });

  it("aggregates the weighted total from item counts", () => {
    const total = gate.aggregateCoverage([coverage(90, 100), coverage(10, 100)]);
    assert.deepEqual(total.lines, { covered: 100, total: 200 });
  });
});

describe("coverage scope", () => {
  it("requires every configured production file and nothing else", () => {
    const expected = gate.expectedCoverageFiles("frontend");
    assert.ok(expected.includes("web/src/lib/api.ts"));
    assert.ok(!expected.some((file) => /\.test\.|\/test\//.test(file)));
    const summary = Object.fromEntries(expected.map((file) => [path.join(common.REPOSITORY_ROOT, file), {}]));
    assert.equal(gate.validateCoverageScope({ total: {}, ...summary }, "frontend"), expected.length);
    const missing = { ...summary };
    delete missing[path.join(common.REPOSITORY_ROOT, expected[0])];
    assert.throws(() => gate.validateCoverageScope(missing, "frontend"), /missing web\/src/);
    assert.throws(
      () => gate.validateCoverageScope({ ...summary, [path.join(common.REPOSITORY_ROOT, "web/src/x.test.ts")]: {} }, "frontend"),
      /unexpected web\/src\/x\.test\.ts/,
    );
  });

  it("honours the documented backend exclusions", () => {
    const expected = gate.expectedCoverageFiles("backend");
    assert.ok(expected.includes("src/server/routes.ts"));
    assert.ok(!expected.includes("src/cli/index.ts"));
    assert.ok(!expected.some((file) => file.startsWith("desktop/")));
  });
});

describe("duplication and lint", () => {
  it("blocks higher duplication ratios and more fragments", () => {
    const current = layer({ duplication: { duplicatedLines: 30, totalLines: 1000, fragments: 3 } });
    const failures = gate.compareLayer("backend", layer(), current, POLICY);
    assert.ok(failures.some((item) => item.includes("duplication increased from 1.00% to 3.00%")));
    assert.ok(failures.some((item) => item.includes("duplicate fragments increased from 2 to 3")));
    assert.equal(gate.duplicationRatioIsHigher({ duplicatedLines: 20, totalLines: 2000 }, { duplicatedLines: 10, totalLines: 1000 }), false);
  });

  it("validates JSCPD statistics", () => {
    const report = { statistics: { total: { lines: 100, duplicatedLines: 5, clones: 1, percentage: 5 } } };
    assert.deepEqual(gate.parseJscpdReport(report), { duplicatedLines: 5, totalLines: 100, fragments: 1 });
    report.statistics.total.percentage = 9;
    assert.throws(() => gate.parseJscpdReport(report), /inconsistent/);
    assert.throws(() => gate.parseJscpdReport({}), /total statistics/);
  });

  it("requires zero ESLint errors and warnings", () => {
    assert.equal(gate.parseEslintReport([{ errorCount: 1, warningCount: 2 }], "backend"), 3);
    assert.throws(() => gate.parseEslintReport([], "backend"), /did not lint any file/);
    const failures = gate.compareLayer("backend", layer(), layer({ violations: { lint: 1, oversizedFiles: 0, oversizedFunctions: 0 } }), POLICY);
    assert.deepEqual(failures, ["backend has 1 ESLint error(s) or warning(s); zero are allowed."]);
  });
});

describe("size limits", () => {
  it("counts physical lines", () => {
    assert.equal(gate.countPhysicalLines(""), 0);
    assert.equal(gate.countPhysicalLines("a\nb\n"), 2);
    assert.equal(gate.countPhysicalLines("a\r\nb"), 2);
  });

  it("measures named functions, methods and nested callbacks", () => {
    const body = Array.from({ length: 101 }, (_, index) => `    const value${index} = ${index};`).join("\n");
    const source = `export function outer() {\n  items.map((item) => {\n${body}\n  });\n}\nclass A { method() { return 1; } }\n`;
    const functions = gate.scanFunctionSizes(source, "example.tsx");
    const callback = functions.find((item) => item.name.startsWith("callback of items.map"));
    assert.equal(callback.lineCount, 103);
    assert.ok(functions.find((item) => item.name === "outer").lineCount > 100);
    assert.equal(functions.find((item) => item.name === "method").lineCount, 1);
    assert.throws(() => gate.scanFunctionSizes("function (", "broken.ts"), /Could not parse broken.ts/);
  });

  it("requires zero oversized files and functions", () => {
    const current = layer({
      violations: { lint: 0, oversizedFiles: 1, oversizedFunctions: 1 },
      details: {
        oversizedFiles: [{ filePath: "web/src/big.tsx", lineCount: 351 }],
        oversizedFunctions: [{ filePath: "web/src/big.tsx", startLine: 3, name: "Big", lineCount: 101 }],
      },
    });
    const failures = gate.compareLayer("frontend", layer(), current, POLICY);
    assert.ok(failures.includes("web/src/big.tsx has 351 lines."));
    assert.ok(failures.includes("web/src/big.tsx:3 Big has 101 lines."));
  });
});

describe("baseline and arguments", () => {
  it("validates the baseline schema", () => {
    assert.equal(gate.validateBaseline(baseline()).schemaVersion, 1);
    assert.throws(() => gate.validateBaseline(baseline({ schemaVersion: 2 })), /Unsupported baseline/);
    assert.throws(() => gate.validateBaseline(baseline({ layers: { backend: layer() } })), /baseline.layers.frontend/);
    assert.throws(() => gate.validateBaseline(baseline({ policy: { ...POLICY, minimumCoverage: 101 } })), /cannot exceed 100/);
  });

  it("selects layers and rejects unknown options", () => {
    assert.deepEqual(gate.parseArguments([]).layers, ["backend", "frontend"]);
    assert.deepEqual(gate.parseArguments(["--layer", "frontend"]).layers, ["frontend"]);
    assert.throws(() => gate.parseArguments(["--layer", "web"]), /Unknown layer/);
    assert.throws(() => gate.parseArguments(["--strict"]), /Unknown argument/);
  });

  it("renders a weighted total only when both layers are evaluated", () => {
    const results = { backend: layer(), frontend: layer() };
    assert.match(gate.renderMarkdown({ baseline: baseline(), results, failures: [], baselineLabel: "base" }), /weighted total/);
    const single = gate.renderMarkdown({ baseline: baseline(), results: { frontend: layer() }, failures: ["x"], baselineLabel: "base" });
    assert.doesNotMatch(single, /weighted total/);
    assert.match(single, /\*\*FAIL\*\*/);
  });
});

describe("report provenance", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quality-gate-"));
  const file = path.join(directory, "coverage-summary.json");
  const previousRun = process.env.GITHUB_RUN_ID;
  after(() => fs.rmSync(directory, { recursive: true, force: true }));
  afterEach(() => {
    if (previousRun === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previousRun;
  });

  it("accepts reports stamped by the current run", () => {
    fs.writeFileSync(file, "{}");
    common.stampArtifact(file, { layer: "frontend", kind: "coverage" });
    assert.equal(common.verifyArtifact(file, { layer: "frontend", kind: "coverage", label: "summary" }).layer, "frontend");
  });

  it("rejects missing, foreign, modified and mislabeled reports", () => {
    fs.writeFileSync(file, "{}");
    common.stampArtifact(file, { layer: "frontend", kind: "coverage" });
    assert.throws(() => common.verifyArtifact(file, { layer: "backend", kind: "coverage", label: "summary" }), /layer/);
    assert.throws(() => common.verifyArtifact(file, { layer: "frontend", kind: "eslint", label: "summary" }), /kind/);
    process.env.GITHUB_RUN_ID = "another-run";
    assert.throws(() => common.verifyArtifact(file, { layer: "frontend", kind: "coverage", label: "summary" }), /runId/);
    delete process.env.GITHUB_RUN_ID;
    fs.writeFileSync(file, "{\"changed\":true}");
    assert.throws(() => common.verifyArtifact(file, { layer: "frontend", kind: "coverage", label: "summary" }), /sha256/);
    fs.rmSync(common.provenancePath(file));
    assert.throws(() => common.verifyArtifact(file, { layer: "frontend", kind: "coverage", label: "summary" }), /provenance/);
    fs.rmSync(file);
    assert.throws(() => common.verifyArtifact(file, { layer: "frontend", kind: "coverage", label: "summary" }), /is missing/);
  });
});
