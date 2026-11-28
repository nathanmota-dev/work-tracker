import { expect, test } from "vitest";
import { profileDate } from "./dates.ts";

test("reads source dates as YYYY-MM, YYYY or Present", () => {
  expect(["2024-7", "2024-07-15", "07/2024", "2024", 2024, "current", "O momento", "July 2024", null].map(profileDate)).toEqual(["2024-07", "2024-07", "2024-07", "2024", "2024", "Present", "Present", "", ""]);
});
