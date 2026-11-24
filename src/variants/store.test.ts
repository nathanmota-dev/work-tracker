import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import { archiveVariant, insertVariant, interruptStaleVariants, listVariants, updateVariant, variantManifest, variantRecord } from "./store.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-24T12:00:00.000Z" }));

let d: Database;
beforeEach(async () => { d = await memoryDatabase(); vi.mocked(db).mockReturnValue(d); });
const profile = { name: "Back-End · C#", role: "backend" as const, stacks: ["C#", ".NET"] };

test("stores generated and imported variants and reports stale sources", () => {
  insertVariant("g", { ...profile, focus: "APIs", language: "en", provider: "opencode", model: null }, "generated");
  d.exec("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES ('pdf', NULL, 'variant', '/a/resume.pdf', 1, 'Text', '[\"Long\"]')");
  insertVariant("i", { name: "Imported", role: "frontend", stacks: ["React"] }, "imported", "pdf");
  expect(variantRecord("g")).toMatchObject({ status: "generating", phase: "preparing", origin: "generated", focus: "APIs", language: "en", provider: "opencode", pdf: null, stale: false, events: [] });
  expect(variantRecord("i")).toMatchObject({ status: "ready", phase: "complete", language: "auto", pdf: { id: "pdf", kind: "variant", pages: 1, warnings: ["Long"] } });
  updateVariant("g", { status: "ready", source_version: "v1", stacks_json: '["C#"]', ignored: "x" } as never);
  updateVariant("g", {});
  expect(variantRecord("g", "v2")).toMatchObject({ status: "ready", stacks: ["C#"], stale: true });
  expect(variantRecord("g", "v1").stale).toBe(false);
  expect(variantRecord("i", "v2").stale).toBe(false);
  expect(listVariants().map(item => item.id)).toEqual(["g", "i"]); // By role: backend before frontend.
  updateVariant("g", { manifest_json: '{"variantId":"g"}' });
  expect(variantManifest("g")).toEqual({ variantId: "g" });
});

test("archives without deleting and interrupts generations left by a closed app", () => {
  insertVariant("g", profile, "generated");
  insertVariant("w", profile, "generated");
  updateVariant("w", { status: "waiting_for_sign_in" });
  archiveVariant("g");
  archiveVariant("g");
  expect(listVariants().map(item => item.id)).toEqual(["w"]);
  expect(listVariants({ includeArchived: true }).map(item => [item.id, item.archivedAt])).toEqual([["w", null], ["g", "2026-11-24T12:00:00.000Z"]]);
  interruptStaleVariants();
  expect(listVariants({ includeArchived: true }).map(item => [item.status, item.error])).toEqual([["interrupted", expect.stringContaining("Regenerate")], ["interrupted", expect.stringContaining("Regenerate")]]);
  expect(() => variantRecord("missing")).toThrow("Saved resume not found.");
  expect(() => variantManifest("missing")).toThrow("Saved resume not found.");
});
