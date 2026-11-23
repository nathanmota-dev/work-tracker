import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import { gateProfile, removeLanguage, saveLanguage, setEligibility } from "./profile-store.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-23T12:00:00.000Z" }));

let d: Database;
beforeEach(async () => { d = await memoryDatabase(); });

test("a new workspace has no languages and no eligibility, so both gates are off", () => {
  expect(gateProfile(d)).toEqual({ languages: [], eligibility: null });
});

test("adds, edits and removes languages, listed alphabetically", () => {
  saveLanguage({ language: " Spanish ", level: "Native", notes: "  " }, d);
  const profile = saveLanguage({ language: "English", level: " B1/B2 ", notes: "Conversational at work" }, d);
  expect(profile.languages).toEqual([
    { id: 2, language: "English", level: "B1/B2", notes: "Conversational at work" },
    { id: 1, language: "Spanish", level: "Native", notes: null },
  ]);
  expect(saveLanguage({ id: 2, language: "english", level: "C1" }, d).languages[0]).toEqual({ id: 2, language: "english", level: "C1", notes: null });
  expect(removeLanguage({ language: "ENGLISH" }, d).languages.map((item) => item.language)).toEqual(["Spanish"]);
  expect(removeLanguage({ id: 1 }, d).languages).toEqual([]);
});

test.each([
  [{ language: " ", level: "Native" }, "Language is required."],
  [{ language: "Spanish", level: "" }, "Level is required."],
  [{ language: "x".repeat(61), level: "Native" }, "at most 60 characters"],
  [{ language: "Spanish", level: "Native", notes: "n".repeat(301) }, "at most 300 characters"],
  [{ id: "abc", language: "Spanish", level: "Native" }, "positive integer"],
  [{ id: 99, language: "Spanish", level: "Native" }, "language #99 not found"],
])("rejects %j without writing", (input, message) => {
  expect(() => saveLanguage(input, d)).toThrow(message);
  expect(gateProfile(d).languages).toEqual([]);
});

test("refuses a duplicate name ignoring case and spacing, also when renaming", () => {
  saveLanguage({ language: "Spanish", level: "Native" }, d);
  saveLanguage({ language: "English", level: "B2" }, d);
  expect(() => saveLanguage({ language: "  SPANISH ", level: "C1" }, d)).toThrow("Spanish is already in your languages. Edit its level instead.");
  expect(() => saveLanguage({ id: 2, language: "spanish", level: "C1" }, d)).toThrow("already in your languages");
  expect(gateProfile(d).languages.map((item) => item.level)).toEqual(["B2", "Native"]);
});

test("removing needs a declared language", () => {
  expect(() => removeLanguage({}, d)).toThrow("Choose the language to remove.");
  expect(() => removeLanguage({ language: "Polish" }, d)).toThrow("Polish is not in your languages.");
  expect(() => removeLanguage({ id: 4 }, d)).toThrow("language #4 is not in your languages.");
});

test("sets and clears the eligibility, rejecting other values", () => {
  expect(setEligibility("needs_permission", d).eligibility).toBe("needs_permission");
  expect(setEligibility("citizen_or_resident", d).eligibility).toBe("citizen_or_resident");
  expect(setEligibility("none", d).eligibility).toBeNull();
  setEligibility("needs_permission", d);
  expect(setEligibility(null, d).eligibility).toBeNull();
  expect(() => setEligibility("tourist", d)).toThrow("eligibility must be one of: citizen_or_resident, needs_permission or none");
  expect(() => setEligibility(undefined, d)).toThrow("eligibility must be one of");
  expect(d.query("SELECT COUNT(*) AS n FROM gate_profile").get()).toEqual({ n: 1 });
});
