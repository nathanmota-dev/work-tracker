import { expect, test } from "vitest";
import { RANK_WEIGHTS, overallScore, verdictBand } from "./bands.ts";

test("weights the three dimensions 35/30/35 and adds up to one", () => {
  expect(RANK_WEIGHTS).toEqual({ technical: 0.35, experience: 0.3, career: 0.35 });
  expect(RANK_WEIGHTS.technical + RANK_WEIGHTS.experience + RANK_WEIGHTS.career).toBeCloseTo(1);
  expect(overallScore({ technical: 100, experience: 100, career: 100 })).toBe(100);
  expect(overallScore({ technical: 0, experience: 0, career: 0 })).toBe(0);
  expect(overallScore({ technical: 80, experience: 70, career: 75 })).toBe(75);
  expect(overallScore({ technical: 90, experience: 40, career: 60 })).toBe(65);
});

test("rounds the weighted score half up without floating-point drift", () => {
  // 0.35 * 75 + 0.30 * 74 + 0.35 * 75 = 74.7
  expect(overallScore({ technical: 75, experience: 74, career: 75 })).toBe(75);
  // 0.35 * 50 + 0.30 * 55 + 0.35 * 50 = 51.5
  expect(overallScore({ technical: 50, experience: 55, career: 50 })).toBe(52);
  expect(overallScore({ technical: 10, experience: 10, career: 10 })).toBe(10);
});

test.each([
  [100, "Strong Fit"], [75, "Strong Fit"], [74, "Good Fit"], [60, "Good Fit"], [59, "Moderate Fit"], [45, "Moderate Fit"],
  [44, "Weak Fit"], [30, "Weak Fit"], [29, "Poor Fit"], [0, "Poor Fit"],
])("score %i falls in %s", (score, band) => {
  expect(verdictBand(score)).toBe(band);
});
