import { expect, test } from "vitest";
import type { JobKeyword } from "./extract.ts";
import { ATS_BANDS, atsBand, atsScore } from "./score.ts";

const keyword = (term: string, weight = 2, section: JobKeyword["section"] = "other"): JobKeyword => ({ term, category: "language", weight, section });

test.each([[100, "strong"], [70, "strong"], [69, "partial"], [50, "partial"], [49, "weak"], [0, "weak"]] as const)("score %i is %s", (score, band) => {
  expect(atsBand(score)).toBe(band);
});

test("labels every band in text", () => {
  expect(ATS_BANDS.map(band => band.label)).toEqual(["Strong match", "Partial match", "Weak match"]);
});

test("scores covered weight over total weight and lists missing terms by weight", () => {
  const keywords = [keyword("C#", 3, "required"), keyword(".NET", 3, "required"), keyword("SQL Server", 3, "required"), keyword("Docker"), keyword("Kafka", 1, "preferred")];
  const result = atsScore(keywords, "Built C# services on .NET with Kafka");
  expect(result).toMatchObject({ score: 58, band: "partial" });
  expect(result.matched.map(item => item.term)).toEqual(["C#", ".NET", "Kafka"]);
  expect(result.missing.map(item => item.term)).toEqual(["SQL Server", "Docker"]);
  expect(result.requiredMissing).toEqual(["SQL Server"]);
  expect(atsScore(keywords, new Set(["C#", ".NET", "SQL Server", "Docker"]))).toMatchObject({ score: 92, band: "strong", requiredMissing: [] });
});

test("49/50 and 69/70 boundaries", () => {
  const half = [keyword("A", 1), keyword("B", 1)].concat(Array.from({ length: 98 }, (_, i) => keyword(`T${i}`, 1)));
  const covered = (count: number) => new Set(half.slice(0, count).map(item => item.term));
  expect(atsScore(half, covered(49))).toMatchObject({ score: 49, band: "weak" });
  expect(atsScore(half, covered(50))).toMatchObject({ score: 50, band: "partial" });
  expect(atsScore(half, covered(69))).toMatchObject({ score: 69, band: "partial" });
  expect(atsScore(half, covered(70))).toMatchObject({ score: 70, band: "strong" });
});

test("gives no score with fewer than three recognized terms", () => {
  expect(atsScore([keyword("Java", 3, "required"), keyword("Git")], "Git")).toEqual({
    score: null, band: null, reason: "too_few_keywords", matched: [keyword("Git")], missing: [keyword("Java", 3, "required")], requiredMissing: ["Java"],
  });
});

test("a JavaScript-only resume does not cover Java", () => {
  expect(atsScore([keyword("Java", 3, "required"), keyword("Spring", 3, "required"), keyword("Git")], "JavaScript, Git").matched.map(item => item.term)).toEqual(["Git"]);
});
