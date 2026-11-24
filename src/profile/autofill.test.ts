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

test("fills only empty answers whose value was not filled before, recording the source", () => {
  // email: typed by the user; phone: empty and new; location: already filled once with this value.
  d.statement.get.mockReturnValueOnce({ value: "typed@example.com" })
    .mockReturnValueOnce({ value: null }).mockReturnValueOnce(undefined)
    .mockReturnValueOnce(undefined).mockReturnValueOnce({ value: "Lisbon" });
  expect(autofillAnswers([field("email", "a@example.com"), field("phone", "+351 912 345 678"), field("location", "Lisbon")])).toEqual(["phone"]);
  expect(saveAnswer).toHaveBeenCalledExactlyOnceWith({ key: "phone", value: "+351 912 345 678" }, d.asDatabase);
  expect(d.statement.run).toHaveBeenCalledWith("phone", "linkedin", "+351 912 345 678", "fixture-time");
});

test("syncs from the configured sources and fills nothing when they cannot be read", () => {
  vi.mocked(profileSourcesState).mockReturnValue({ personal: [field("phone", "+351 912 345 678")] } as ProfileSourcesState);
  expect(syncProfileAnswers()).toEqual(["phone"]);
  vi.mocked(profileSourcesState).mockImplementation(() => { throw new Error("unreadable"); });
  expect(syncProfileAnswers()).toEqual([]);
});
