import { beforeEach, expect, test, vi } from "vitest";
import { Database } from "../../db/sqlite.ts";
import { migrateDatabase } from "../../db/migrations.ts";
import { db } from "../../db/index.ts";
import { deleteAnswer, listAnswerVariants, saveAnswer } from "../../answers/store.ts";
import { autofillAnswers, syncProfileAnswers } from "../../profile/autofill.ts";
import { profileSourcesState } from "../../profile/state.ts";
import type { PersonalField, ProfileSourcesState } from "../../profile/types.ts";

vi.mock("../../db/index.ts", () => ({ db: vi.fn(), now: () => "fixture-time" }));
vi.mock("../../profile/state.ts", () => ({ profileSourcesState: vi.fn() }));

let d: Database;
beforeEach(() => {
  d = new Database(":memory:");
  migrateDatabase(d, { backupDir: "/unused" });
  vi.mocked(db).mockReturnValue(d);
});
const fields: PersonalField[] = [
  { key: "email", value: "alex@data.example", source: "data" },
  { key: "phone", value: "+351 912 345 678", source: "linkedin" },
  { key: "github_url", value: "https://github.com/alex", source: "resume" },
];
const value = (key: string) => (d.query("SELECT value FROM applicant_answers WHERE key = ?").get(key) as { value: string | null } | undefined)?.value;

test("fills empty answers and records the source, never replacing what the user typed", () => {
  saveAnswer({ key: "email", value: "typed@example.com" }, d);
  saveAnswer({ key: "phone", value: null }, d);
  expect(autofillAnswers(fields, d)).toEqual(["phone", "github_url"]);
  expect([value("email"), value("phone"), value("github_url")]).toEqual(["typed@example.com", "+351 912 345 678", "https://github.com/alex"]);
  expect(Object.fromEntries(listAnswerVariants(d).map(row => [row.key, row.autofill_source]))).toEqual({ email: null, phone: "linkedin", github_url: "resume" });
  expect(autofillAnswers(fields, d)).toEqual([]);
});

test("a cleared value is not filled again until the source changes it, and an edit drops the origin", () => {
  autofillAnswers(fields, d);
  deleteAnswer({ key: "phone" }, d);
  expect(autofillAnswers(fields, d)).toEqual([]);
  expect(value("phone")).toBeUndefined();
  expect(autofillAnswers([{ key: "phone", value: "+351 900 000 000", source: "data" }], d)).toEqual(["phone"]);
  saveAnswer({ key: "github_url", value: "https://github.com/alex-edited" }, d);
  expect(listAnswerVariants(d).find(row => row.key === "github_url")?.autofill_source).toBeNull();
});

test("syncs from the configured sources and tolerates sources that cannot be read", () => {
  vi.mocked(profileSourcesState).mockReturnValue({ personal: [fields[0]!] } as ProfileSourcesState);
  expect(syncProfileAnswers()).toEqual(["email"]);
  vi.mocked(profileSourcesState).mockImplementation(() => { throw new Error("unreadable"); });
  expect(syncProfileAnswers()).toEqual([]);
});
