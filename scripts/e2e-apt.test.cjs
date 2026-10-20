"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");

const ROOT = path.join(__dirname, "..");
const INSTALLER = path.join(ROOT, "scripts/ci/install-e2e-apt.sh");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-apt-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  const log = path.join(directory, "apt.jsonl");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "sudo"), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 });
  const mock = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.APT_TEST_LOG, JSON.stringify({ name, args }) + "\\n");
if (name === "apt-get") {
  if (process.env.APT_TEST_FAIL === "all") process.exit(1);
  if (args.includes("install") && !args.includes("-s") && process.env.DEBIAN_FRONTEND !== "noninteractive") process.exit(2);
}
if (name === "tar") {
  if (args.includes("-xf") && process.env.APT_TEST_RESTORE_FAIL) process.exit(1);
  if (args.includes("-cf")) fs.writeFileSync(args[args.indexOf("-cf") + 1], "state");
}
if (name === "latexmk") {
  const marker = path.join(process.env.RUNNER_TEMP, "probe-failed");
  if (process.env.APT_TEST_PROBE_FAIL === "all" || (process.env.APT_TEST_PROBE_FAIL === "once" && !fs.existsSync(marker))) {
    fs.writeFileSync(marker, "failed"); process.exit(1);
  }
  fs.writeFileSync("probe.pdf", "pdf");
}
if (name === "pdftotext") fs.writeFileSync(args[1], "E2E cache probe");
`;
  for (const name of ["apt-get", "tar", "ldconfig", "xvfb-run", "xauth", "latexmk", "pdflatex", "pdfinfo", "pdftotext"]) {
    fs.writeFileSync(path.join(bin, name), mock, { mode: 0o755 });
  }
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: directory, APT_TEST_LOG: log };
  return {
    directory,
    env,
    calls: () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((call) => call.name === "apt-get").map((call) => call.args) : [],
    run: (extra = {}) => spawnSync("bash", [INSTALLER], { cwd: ROOT, env: { ...env, ...extra }, encoding: "utf8" }),
  };
}

describe("Electron apt installer", { skip: process.platform !== "linux" }, () => {
  it("uses an already configured cold installation and saves generated state", (t) => {
    const f = fixture(t);
    const result = f.run({ APT_CACHE_OUTCOME: "success", APT_CACHE_HIT: "false" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.calls().length, 0);
    assert.ok(fs.existsSync(path.join(f.directory, "electron-e2e-apt/tex-state.tar")));
  });

  it("validates a complete cache hit without invoking apt", (t) => {
    const f = fixture(t);
    const result = f.run({ APT_CACHE_OUTCOME: "success", APT_CACHE_HIT: "true", TEX_CACHE_HIT: "true" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated system dependencies restored from cache/);
    assert.equal(f.calls().length, 0);
  });

  for (const [label, extra] of [
    ["failed package action", { APT_CACHE_OUTCOME: "failure" }],
    ["missing TeX configuration", { TEX_CACHE_HIT: "false" }],
    ["corrupt TeX archive", { APT_TEST_RESTORE_FAIL: "true" }],
    ["failed compilation probe", { APT_TEST_PROBE_FAIL: "once" }],
  ]) {
    it(`falls back to normal apt after ${label}`, (t) => {
      const f = fixture(t);
      const result = f.run({ APT_CACHE_OUTCOME: "success", APT_CACHE_HIT: "true", TEX_CACHE_HIT: "true", ...extra });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(f.calls()[0], ["update"]);
      assert.ok(f.calls()[1].includes("--no-install-recommends"));
      assert.equal(f.calls().length, 2);
    });
  }

  for (const extra of [{ APT_TEST_FAIL: "all" }, { APT_TEST_PROBE_FAIL: "all" }]) {
    it(`blocks real installation or compilation errors: ${JSON.stringify(extra)}`, (t) => {
      const f = fixture(t);
      assert.notEqual(f.run(extra).status, 0);
    });
  }

  it("covers the locked Playwright Chromium packages and the Electron/LaTeX tools", (t) => {
    const f = fixture(t);
    const cli = path.join(path.dirname(require.resolve("@playwright/test/package.json")), "cli.js");
    const dryRun = spawnSync(process.execPath, [cli, "install-deps", "chromium", "--dry-run"], {
      cwd: ROOT,
      env: { ...f.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: "ubuntu24.04-x64" },
      encoding: "utf8",
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const simulation = f.calls().find((args) => args.includes("-s"));
    assert.ok(simulation, "Playwright must simulate its Ubuntu 24.04 dependency list");
    assert.equal(f.run({ APT_CACHE_HIT: "false" }).status, 0);
    const installation = f.calls().at(-1);
    const packages = installation.slice(installation.indexOf("--no-install-recommends") + 1);
    for (const name of [...simulation.slice(simulation.indexOf("--no-install-recommends") + 1),
      "xvfb", "xauth", "libgtk-3-0t64", "latexmk", "texlive-latex-base", "poppler-utils"]) {
      assert.ok(packages.includes(name), `Missing apt package: ${name}`);
    }
    assert.equal(new Set(packages).size, packages.length, "Package list must not contain duplicates");
  });
});
