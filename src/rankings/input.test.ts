import { expect, test } from "vitest";
import { rankingInput } from "./input.ts";

test("maps the skill's result file to a ranking input", () => {
  expect(rankingInput(4, { status: "scored", scores: { technical: 80, experience: 70, career: 75 }, strengths: ["A"], gaps: ["B"] })).toEqual({
    jobId: 4, status: "scored", technical: 80, experience: 70, career: 75, strengths: ["A"], gaps: ["B"], fetch_error: undefined,
  });
  expect(rankingInput(4, { status: "unreachable", fetch_error: "404 Not Found" })).toMatchObject({ status: "unreachable", technical: undefined, fetch_error: "404 Not Found" });
});

test.each([
  [null, "must be a JSON object"],
  [[], "must be a JSON object"],
  [{}, "status is required"],
  [{ status: "scored", overall: 90 }, "overall is computed by Work Tracker"],
  [{ status: "scored", verdict: "Strong Fit" }, "verdict is computed by Work Tracker"],
  [{ status: "scored", key: "x" }, 'unknown field "key"'],
  [{ status: "scored", scores: [1, 2, 3] }, "scores must be an object"],
  [{ status: "scored", scores: { technical: 1, behavioral: 50 } }, 'unknown score "behavioral"'],
])("refuses %j", (value, message) => {
  expect(() => rankingInput(1, value)).toThrow(message);
});
