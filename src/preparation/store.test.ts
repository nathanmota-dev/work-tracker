import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import { databaseDouble } from "../test/doubles.ts";
import {
  addArtifact,
  artifactFile,
  artifactsForRun,
  cachedPreview,
  pdfBytes,
  runManifest,
  runRecord,
  updateRun,
} from "./store.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "now" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
let d: ReturnType<typeof databaseDouble>;
const row = {
  id: "p",
  kind: "base",
  path: "/artifacts/base.pdf",
  text: "resume",
  pages: 1,
  warnings_json: '["warning"]',
};
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  vi.spyOn(fs, "realpathSync").mockImplementation((path) => String(path));
});
test("decodes runs and manifests without exposing internal JSON fields", () => {
  d.statement.get.mockReturnValue({
    id: "r",
    events_json: '[{"type":"log"}]',
    manifest_json: '{"project":"p"}',
    options_json: "{}",
  });
  d.statement.all.mockReturnValue([row]);
  expect(runRecord("r")).toEqual({
    id: "r",
    events: [{ type: "log" }],
    artifacts: [expect.objectContaining({ warnings: ["warning"] })],
  });
  expect(runManifest("r")).toEqual({ project: "p" });
});
test("missing runs and artifacts report domain errors", () => {
  for (const action of [
    () => runRecord("missing"),
    () => runManifest("missing"),
    () => artifactFile("missing"),
  ])
    expect(action).toThrow(expect.objectContaining({ status: 404 }));
});
test("updates only allowed fields and skips empty/unsupported updates", () => {
  updateRun("r", {});
  updateRun("r", { id: "ignored" });
  expect(db).not.toHaveBeenCalled();
  updateRun("r", { status: "failed", error: null, id: "ignored" });
  expect(d.query).toHaveBeenCalledWith(
    "UPDATE application_runs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
  );
  expect(d.statement.run).toHaveBeenCalledWith("failed", null, "now", "r");
});
test("stores artifact metadata and decodes warnings", () => {
  const result = addArtifact(
    null,
    "base",
    row.path,
    { pages: 1, text: "resume", warnings: ["warning"] },
    "version",
  );
  expect(result).toEqual({
    id: expect.any(String),
    kind: "base",
    pages: 1,
    warnings: ["warning"],
  });
  expect(d.statement.run).toHaveBeenCalledWith(
    result.id,
    null,
    "base",
    row.path,
    1,
    "resume",
    '["warning"]',
    "version",
  );
  addArtifact("r", "tailored", row.path, {
    pages: 1,
    text: "resume",
    warnings: [],
  });
  expect(d.statement.run).toHaveBeenLastCalledWith(
    expect.any(String),
    "r",
    "tailored",
    row.path,
    1,
    "resume",
    "[]",
    null,
  );
  d.statement.all.mockReturnValue([
    { id: "p", kind: "base", pages: 1, warnings_json: "[]" },
  ]);
  expect(artifactsForRun("r")).toEqual([
    { id: "p", kind: "base", pages: 1, warnings: [] },
  ]);
});
test("reads bytes only from a resolved artifact path", () => {
  d.statement.get.mockReturnValue(row);
  vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("%PDF-"));
  expect(artifactFile("p")).toEqual({
    path: row.path,
    text: "resume",
    artifact: { id: "p", kind: "base", pages: 1, warnings: ["warning"] },
  });
  expect(pdfBytes("p")).toEqual(Buffer.from("%PDF-"));
  expect(fs.readFileSync).toHaveBeenCalledWith(row.path);
});
test.each(["/elsewhere/file.pdf", "/artifacts/../secret.pdf", "/artifacts"])(
  "rejects unsafe resolved path %s",
  (path) => {
    d.statement.get.mockReturnValue({ ...row, path });
    expect(() => artifactFile("p")).toThrow("outside the artifact folder");
    expect(fs.readFileSync).not.toHaveBeenCalled();
  },
);
test("cache returns only existing valid artifacts", () => {
  expect(cachedPreview("v")).toBeNull();
  d.statement.get.mockReturnValueOnce({ id: "p" }).mockReturnValueOnce(row);
  expect(cachedPreview("v")).toEqual(expect.objectContaining({ id: "p" }));
  d.statement.get.mockReturnValueOnce({ id: "p" }).mockReturnValueOnce(row);
  vi.mocked(fs.realpathSync).mockImplementation(() => {
    throw new Error("ENOENT");
  });
  expect(cachedPreview("v")).toBeNull();
});
