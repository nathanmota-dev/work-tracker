"use strict";

// Static checks for the PR workflows: triggers, concurrency and path filters.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const { selectLayers } = require("./ci/benchmark-layers.cjs");

const WORKFLOWS = path.join(__dirname, "..", ".github", "workflows");
const PR_WORKFLOWS = ["backend-ci.yml", "frontend-ci.yml", "performance.yml", "e2e.yml"];
const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), "utf8");

/** Reads the quoted `paths:` list of a pull_request trigger. */
function pathFilters(name) {
  const lines = read(name).split("\n");
  const start = lines.findIndex((line) => line.trim() === "paths:");
  assert.notEqual(start, -1, `${name} has no paths filter`);
  const filters = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("#")) continue;
    const match = line.match(/^\s+- "([^"]+)"$/);
    if (!match) break;
    filters.push(match[1]);
  }
  return filters;
}

function triggers(name, changedFiles) {
  const filters = pathFilters(name);
  return changedFiles.some((file) => filters.some((pattern) => path.matchesGlob(file, pattern)));
}

describe("pull request triggers", () => {
  for (const name of PR_WORKFLOWS) {
    it(`${name} runs only for pull requests to main`, () => {
      const source = read(name);
      assert.match(source, /on:\n {2}pull_request:\n {4}branches: \[main\]\n {4}types: \[opened, synchronize, reopened, ready_for_review\]/);
      assert.doesNotMatch(source, /^\s*(push|workflow_run|schedule):/m);
      assert.match(source, /group: [a-z0-9-]+-\$\{\{ github\.event\.pull_request\.number \}\}/);
      assert.match(source, /cancel-in-progress: true/);
    });
  }

  it("keeps backend and frontend CI independent", () => {
    for (const name of ["backend-ci.yml", "frontend-ci.yml"]) {
      const source = read(name);
      assert.doesNotMatch(source, /workflow_run|download-artifact/);
      assert.match(source, /uses: \.\/\.github\/workflows\/quality-gate\.yml/);
    }
    assert.match(read("quality-gate.yml"), /on:\n {2}workflow_call:/);
  });

  it("uses the same virtual display entrypoint locally and in Electron CI", () => {
    const source = read("e2e.yml");
    assert.match(source, /run: bash scripts\/ci\/install-e2e-apt.sh/);
    assert.match(source, /run: npm run test:e2e\n/);
    assert.doesNotMatch(source, /run: xvfb-run/);
  });
});

describe("Electron system dependency cache", () => {
  it("versions installed packages and TeX configuration and tolerates cache service failures", () => {
    const source = read("e2e.yml");
    assert.match(source, /CACHE_VERSION: electron-e2e-apt-v\d+-\$\{\{ runner.os \}\}-\$\{\{ runner.arch \}\}-ubuntu24.04-\$\{\{ hashFiles\('package-lock.json', 'scripts\/ci\/install-e2e-apt.sh'\) \}\}/);
    for (const action of ["restore", "save"]) {
      assert.match(source, new RegExp(`continue-on-error: true\\n +uses: actions/cache/${action}@[a-f0-9]{40}`));
    }
    assert.match(source, /APT_CACHE_HIT: \$\{\{ steps.apt-cache.outputs.cache-hit \}\}/);
    assert.match(source, /if: steps.tex-cache.outputs.cache-hit != 'true'/);
    assert.match(source, /key: \$\{\{ steps.tex-cache.outputs.cache-primary-key \}\}/);
    assert.equal(source.match(/path: \$\{\{ runner.temp \}\}\/electron-e2e-apt/g)?.length, 2);
    assert.match(source, /continue-on-error: true\n +uses: awalsh128\/cache-apt-pkgs-action@[a-f0-9]{40}/);
    assert.match(source, /key: tex-state-\$\{\{ steps.apt-packages.outputs.version \}\}/);
    assert.ok(source.includes('echo "version=$CACHE_VERSION-${ImageVersion:-local}"'));
    assert.match(source, /packages: \$\{\{ steps.apt-packages.outputs.packages \}\}/);
    assert.match(source, /version: \$\{\{ steps.apt-packages.outputs.version \}\}/);
    assert.match(source, /TEX_CACHE_HIT: \$\{\{ steps.tex-cache.outputs.cache-hit \}\}/);
    assert.match(source, /APT_CACHE_OUTCOME: \$\{\{ steps.apt-cache.outcome \}\}/);
    assert.match(source, /execute_install_scripts: false/);
    assert.doesNotMatch(source, /npx playwright install-deps|--shard|--workers/);
  });
});

describe("path filters", () => {
  const cases = [
    ["backend-only change", ["src/server/routes.ts"], { backend: true, frontend: false }],
    ["Electron main process", ["desktop/src/main.ts"], { backend: true, frontend: false }],
    ["frontend-only change", ["web/src/routes/jobs.tsx"], { backend: false, frontend: true }],
    ["shared application contract", ["src/applications/types.ts"], { backend: true, frontend: true }],
    ["shared search normalization", ["src/jobs/search-results.ts"], { backend: true, frontend: true }],
    ["shared job identity", ["src/jobs/identity.ts"], { backend: true, frontend: true }],
    ["shared preparation contract", ["src/preparation/types.ts"], { backend: true, frontend: true }],
    ["lockfile", ["package-lock.json"], { backend: true, frontend: true }],
    ["shared lint configuration", ["eslint.config.mjs"], { backend: true, frontend: true }],
    ["quality gate script", ["scripts/quality-gate.cjs"], { backend: true, frontend: true }],
    ["reusable gate workflow", [".github/workflows/quality-gate.yml"], { backend: true, frontend: true }],
    ["documentation", ["docs/e2e.md", "README.md"], { backend: false, frontend: false }],
  ];
  for (const [label, files, expected] of cases) {
    it(`${label} triggers ${JSON.stringify(expected)}`, () => {
      assert.equal(triggers("backend-ci.yml", files), expected.backend);
      assert.equal(triggers("frontend-ci.yml", files), expected.frontend);
    });
  }
});

describe("performance workflow", () => {
  const source = read("performance.yml");
  const steps = source.split(/\n {6}- name: /).slice(1).map((step) => ({ name: step.split("\n")[0], body: step }));
  const step = (name) => {
    const found = steps.find((item) => item.name === name);
    assert.ok(found, `missing step: ${name}`);
    return found;
  };
  const position = (name) => steps.indexOf(step(name));

  it("measures the base and the head in the same job without a committed baseline", () => {
    assert.equal(source.match(/^ {2}[a-z-]+:\n {4}name:/gm)?.length, 1, "performance.yml must keep a single job");
    assert.match(step("Checkout pull request head").body, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n +path: pr-head/);
    assert.match(step("Checkout pull request base").body, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n +path: pr-base/);
    assert.match(step("Base microbenchmarks").body, /working-directory: pr-base/);
    assert.match(step("Base microbenchmarks").body, /node scripts\/benchmark-gate\.cjs --capture "\$BASE_MEASUREMENT" --projects "\$LAYERS"/);
    assert.match(step("Head microbenchmarks").body, /working-directory: pr-head/);
    assert.match(step("Compare head with base").body, /--baseline "\$BASE_MEASUREMENT" --projects "\$LAYERS"/);
    assert.match(step("Compare head with base").body, /main@\$\{BASE_SHA:0:12\} \(measured on this runner\)/);
    assert.ok(position("Base microbenchmarks") < position("Head microbenchmarks"));
    assert.ok(position("Head microbenchmarks") < position("Compare head with base"));
    assert.doesNotMatch(source, /benchmark-baseline\.json|git show "\$\{BASE_SHA\}/);
    assert.equal(fs.existsSync(path.join(__dirname, "benchmark-baseline.json")), false);
  });

  it("judges the head with the base's runner and gate, after testing the PR's scripts", () => {
    const overlay = step("Use the base's benchmark runner and gate").body;
    assert.match(overlay, /cp pr-base\/scripts\/benchmark-gate\.cjs pr-head\/scripts\/benchmark-gate\.cjs/);
    assert.match(overlay, /cp pr-base\/scripts\/ci\/benchmark\.cjs pr-base\/scripts\/ci\/common\.cjs pr-head\/scripts\/ci\//);
    assert.match(step("Test gate scripts").body, /working-directory: pr-head\n +run: npm run test:infra/);
    assert.ok(position("Test gate scripts") < position("Use the base's benchmark runner and gate"));
    assert.ok(position("Use the base's benchmark runner and gate") < position("Head microbenchmarks"));
    for (const name of ["Base microbenchmarks", "Head microbenchmarks"]) {
      assert.match(step(name).body, /node scripts\/ci\/benchmark\.cjs "\$layer"/);
      assert.doesNotMatch(step(name).body, /npm run benchmark/);
    }
  });

  it("selects layers from the PR diff and blocks every failed measurement", () => {
    assert.match(step("Select benchmark layers").body, /node scripts\/ci\/benchmark-layers\.cjs "\$BASE_SHA" "\$HEAD_SHA" >> "\$GITHUB_OUTPUT"/);
    const enforce = step("Enforce blocking performance checks").body;
    for (const check of ["gate script tests", "base microbenchmarks", "head microbenchmarks", "benchmark comparison"]) {
      assert.ok(enforce.includes(`failures+=("${check}")`), check);
    }
    assert.match(step("Upload performance reports").body, /base-benchmarks\.json\n +pr-base\/reports\/benchmarks\/\n +pr-head\/reports\/benchmarks\//);
  });

  const cases = [
    ["backend source", ["src/server/routes.ts"], ["backend"]],
    ["Electron main process", ["desktop/src/main.ts"], ["backend"]],
    ["backend benchmark", ["benchmarks/backend.bench.ts", "vitest.benchmark.config.mts"], ["backend"]],
    ["frontend source", ["web/src/routes/jobs.tsx"], ["frontend"]],
    ["frontend benchmark", ["web/benchmarks/frontend.bench.ts"], ["frontend"]],
    ["shared application contract", ["src/applications/types.ts"], ["backend", "frontend"]],
    ["shared job identity", ["src/jobs/identity.ts"], ["backend", "frontend"]],
    ["lockfile", ["package-lock.json"], ["backend", "frontend"]],
    ["benchmark gate", ["scripts/benchmark-gate.cjs"], ["backend", "frontend"]],
    ["benchmark runner", ["scripts/ci/benchmark.cjs"], ["backend", "frontend"]],
    ["performance workflow", [".github/workflows/performance.yml"], ["backend", "frontend"]],
    ["documentation", ["docs/ci.md", "README.md", "AGENTS.md"], []],
    ["other workflow", [".github/workflows/e2e.yml", "e2e/jobs.spec.ts"], []],
  ];
  for (const [label, files, expected] of cases) {
    it(`${label} measures ${JSON.stringify(expected)}`, () => {
      const selected = selectLayers(files);
      assert.deepEqual(selected.layers, expected);
      assert.equal(selected.backend, expected.includes("backend"));
      assert.equal(selected.frontend, expected.includes("frontend"));
    });
  }
});
