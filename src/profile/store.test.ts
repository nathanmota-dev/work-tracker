import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import { PARSER_VERSION } from "./linkedin/parse.ts";
import { cachedImports, profileChoices, saveChoice, saveImport } from "./store.ts";
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

test("records, replaces and forgets decisions", () => {
  saveChoice("k1", { field: "work.start", source: "data", value: "2022-11" });
  saveChoice("k1", { field: "work.start", source: "linkedin", value: "2022-12" });
  saveChoice("k2", { field: "work.end", source: "data", value: "2024" });
  expect(profileChoices()).toEqual(new Map([["k1", "linkedin"], ["k2", "data"]]));
  expect(d.query("SELECT field, chosen_value, decided_at FROM profile_choices WHERE conflict_key = 'k1'").get()).toEqual({ field: "work.start", chosen_value: "2022-12", decided_at: "2026-11-24T12:00:00.000Z" });
  saveChoice("k2", null);
  expect([...profileChoices().keys()]).toEqual(["k1"]);
});
