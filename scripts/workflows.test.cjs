"use strict";

// Static checks for the PR workflows: triggers, concurrency and path filters.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

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
});

describe("path filters", () => {
  const cases = [
    ["backend-only change", ["src/server/routes.ts"], { backend: true, frontend: false }],
    ["Electron main process", ["desktop/src/main.ts"], { backend: true, frontend: false }],
    ["frontend-only change", ["web/src/routes/jobs.tsx"], { backend: false, frontend: true }],
    ["shared application contract", ["src/applications/types.ts"], { backend: true, frontend: true }],
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
