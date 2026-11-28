import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { db } from "../db/index.ts";
import { saveAnswer } from "../answers/store.ts";
import { autofillAnswers, syncProfileAnswers } from "./autofill.ts";
import { profileSourcesState } from "./state.ts";
import type { PersonalField, ProfileSourcesState } from "./types.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "fixture-time" }));
vi.mock("../answers/store.ts", () => ({ saveAnswer: vi.fn() }));
vi.mock("./state.ts", () => ({ profileSourcesState: vi.fn() }));

let d: ReturnType<typeof databaseDouble>;
beforeEach(() => { d = databaseDouble(); vi.mocked(db).mockReturnValue(d.asDatabase); });
const field = (key: PersonalField["key"], value: string): PersonalField => ({ key, value, source: "linkedin" });

test("fills empty answers, follows the profile where it filled them and never replaces typed or cleared values", () => {
  // Each field reads its answer, then what the profile filled before.
  const rows: [{ value: string | null } | undefined, { value: string } | undefined][] = [
    [{ value: "typed@example.com" }, undefined], // email: typed by the user
    [{ value: null }, undefined], // phone: empty and new
    [undefined, { value: "Lisbon" }], // location: filled once with this value, then cleared
    [{ value: "Old summary" }, { value: "Old summary" }], // summary: filled before, the profile changed it
    [{ value: "Alex Example" }, { value: "Alex Example" }], // full_name: unchanged
  ];
  for (const [answer, previous] of rows) d.statement.get.mockReturnValueOnce(answer).mockReturnValueOnce(previous);
  expect(autofillAnswers([field("email", "a@example.com"), field("phone", "+351 912 345 678"), field("location", "Lisbon"), field("summary", "New summary"), field("full_name", "Alex Example")])).toEqual(["phone", "summary"]);
  expect(saveAnswer).toHaveBeenCalledWith({ key: "phone", value: "+351 912 345 678" }, d.asDatabase);
  expect(saveAnswer).toHaveBeenCalledWith({ key: "summary", value: "New summary" }, d.asDatabase);
  expect(saveAnswer).toHaveBeenCalledTimes(2);
  expect(d.statement.run).toHaveBeenCalledWith("phone", "linkedin", "+351 912 345 678", "fixture-time");
});

test("syncs from the configured sources and fills nothing when they cannot be read", () => {
  vi.mocked(profileSourcesState).mockReturnValue({ personal: [field("phone", "+351 912 345 678")] } as ProfileSourcesState);
  expect(syncProfileAnswers()).toEqual(["phone"]);
  vi.mocked(profileSourcesState).mockImplementation(() => { throw new Error("unreadable"); });
  expect(syncProfileAnswers()).toEqual([]);
});
