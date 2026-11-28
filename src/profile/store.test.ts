import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import { PARSER_VERSION } from "./linkedin/parse.ts";
import { cachedImports, saveImport } from "./store.ts";
import type { LinkedInProfile } from "./types.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-24T12:00:00.000Z" }));

let d: Database;
beforeEach(async () => { d = await memoryDatabase(); vi.mocked(db).mockReturnValue(d); });
const profile = { name: "Alex Example", experience: [] } as unknown as LinkedInProfile;

test("caches imports by hash and treats another parser version as missing", () => {
  expect(cachedImports([])).toEqual(new Map());
  saveImport({ hash: "a", kind: "linkedin", file: "export.pdf", profile, text: "Alex", warnings: [] });
  saveImport({ hash: "b", kind: "reference", file: "old.pdf", profile: null, text: "", warnings: ["Unreadable"] });
  saveImport({ hash: "b", kind: "reference", file: "renamed.pdf", profile: null, text: "Resume", warnings: [] });
  d.exec(`INSERT INTO profile_imports (pdf_hash, kind, file_name, parser_version, imported_at) VALUES ('c', 'reference', 'c.pdf', ${PARSER_VERSION - 1}, 'then')`);
  expect([...cachedImports(["a", "b", "c", "missing"]).values()]).toEqual([
    { hash: "a", kind: "linkedin", file: "export.pdf", parserVersion: PARSER_VERSION, profile, text: "Alex", warnings: [] },
    { hash: "b", kind: "reference", file: "renamed.pdf", parserVersion: PARSER_VERSION, profile: null, text: "Resume", warnings: [] },
  ]);
});

