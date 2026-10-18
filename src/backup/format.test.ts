import { expect, test } from "vitest";
import { SCHEMA_VERSION } from "../db/schema.ts";
import { errorText, isContainedPath, parseManifest, sha256, summarize } from "./format.ts";

const hash = sha256("bytes");
const valid = () => ({
  format: "work-tracker-backup", formatVersion: 1, appVersion: "1.0.0", schemaVersion: 4, createdAt: "2026-10-18T00:00:00.000Z",
  sourceHome: "/home/source", counts: { jobs: 2 },
  files: [
    { path: "database/work-tracker.db", kind: "database", size: 10, sha256: hash },
    { path: "config/config.json", kind: "config", size: 2, sha256: hash },
    { path: "artifacts/a/resume.pdf", kind: "artifact", size: 5, sha256: hash },
  ],
  excluded: [{ kind: "browser-session", path: "/home/source/browsers", reason: "device" }, "ignored"],
});
const parse = (edit: (manifest: Record<string, any>) => void = () => {}) => {
  const manifest = valid();
  edit(manifest);
  return parseManifest(JSON.stringify(manifest));
};

test("parses a valid manifest and keeps only well-formed exclusions", () => {
  const manifest = parse();
  expect(manifest.files.map(file => file.kind)).toEqual(["database", "config", "artifact"]);
  expect(manifest.excluded).toEqual([{ kind: "browser-session", path: "/home/source/browsers", reason: "device" }]);
  expect(parse(m => { delete m.excluded; }).excluded).toEqual([]);
});

test("summarizes the manifest with a fingerprint of its exact text", () => {
  const text = JSON.stringify(valid());
  expect(summarize("/b", parseManifest(text), text)).toMatchObject({ path: "/b", fingerprint: sha256(text), files: 3, artifacts: 1, bytes: 17, schemaVersion: 4 });
});

test.each([
  ["", false], ["a\\b", false], ["a\0b", false], ["/etc/passwd", false], ["a/./b", false], [".", false], ["..", false],
  ["../escape", false], ["artifacts/../x", false], ["artifacts/x.pdf", true],
])("contains path %j: %s", (path, expected) => expect(isContainedPath(path)).toBe(expected));

test.each([
  ["corrupted JSON", null, "corrupted"],
  ["another format", (m: Record<string, any>) => { m.format = "other"; }, "not a Work Tracker backup"],
  ["a non-object", (m: Record<string, any>) => { m.format = undefined; }, "not a Work Tracker backup"],
  ["a newer format", (m: Record<string, any>) => { m.formatVersion = 2; }, "format v2 is not supported"],
  ["an invalid schema version", (m: Record<string, any>) => { m.schemaVersion = -1; }, "invalid schema version"],
  ["a newer schema", (m: Record<string, any>) => { m.schemaVersion = SCHEMA_VERSION + 1; }, `schema v${SCHEMA_VERSION + 1}, newer`],
  ["a missing app version", (m: Record<string, any>) => { m.appVersion = 1; }, "missing its version"],
  ["a missing origin", (m: Record<string, any>) => { delete m.sourceHome; }, "missing its version"],
  ["a missing date", (m: Record<string, any>) => { delete m.createdAt; }, "missing its version"],
  ["an invalid date", (m: Record<string, any>) => { m.createdAt = "yesterday"; }, "missing its version"],
  ["invalid counts", (m: Record<string, any>) => { m.counts = { jobs: -1 }; }, "invalid record counts"],
  ["missing counts", (m: Record<string, any>) => { m.counts = []; }, "invalid record counts"],
  ["no file list", (m: Record<string, any>) => { m.files = {}; }, "no file list"],
  ["a malformed entry", (m: Record<string, any>) => { m.files[1] = "config"; }, "invalid file entry"],
  ["a non-string path", (m: Record<string, any>) => { m.files[1].path = 1; }, "invalid file entry"],
  ["a negative size", (m: Record<string, any>) => { m.files[1].size = -1; }, "invalid file entry"],
  ["a non-string hash", (m: Record<string, any>) => { m.files[1].sha256 = 1; }, "invalid file entry"],
  ["a short hash", (m: Record<string, any>) => { m.files[1].sha256 = "abc"; }, "invalid file entry"],
  ["an escaping path", (m: Record<string, any>) => { m.files[2].path = "../outside.pdf"; }, "outside the backup folder"],
  ["an unknown area", (m: Record<string, any>) => { m.files[2].path = "browsers/cookies"; }, "unexpected file"],
  ["a mislabeled kind", (m: Record<string, any>) => { m.files[2].kind = "config"; }, "unexpected file"],
  ["a duplicated file", (m: Record<string, any>) => { m.files.push(m.files[2]); }, "lists a file twice"],
  ["no database", (m: Record<string, any>) => { m.files.shift(); }, "exactly one database"],
] as const)("rejects %s", (_name, edit, message) => {
  expect(() => (edit ? parse(edit) : parseManifest("{"))).toThrow(message);
});

test("formats unknown errors", () => {
  expect(errorText(new Error("boom"))).toBe("boom");
  expect(errorText("plain")).toBe("plain");
});
