import { expect, test } from "vitest";
import { ANSWER_CATALOG, answerLanguage, resolveAnswer, validateAnswer } from "./catalog.ts";
import { KEY_SPECS } from "../match/synonyms.ts";
import { matchLabels } from "../match/matcher.ts";

test("catalog preserves every matcher key and marks demographics for human review", () => {
  expect(ANSWER_CATALOG.map(s => s.key)).toEqual(KEY_SPECS.map(s => s.key));
  expect(ANSWER_CATALOG.filter(s => s.humanOnly).map(s => s.category)).toEqual(["eeo", "eeo", "eeo", "eeo"]);
});
test.each([
  ["email", "invalid", true], ["email", "a@example.test", false],
  ["portfolio_url", "javascript:alert(1)", true], ["portfolio_url", "https://example.test", false],
  ["linkedin_url", "https://linkedin.com/company/test", true], ["linkedin_url", "https://linkedin.com/in/test/", false],
  ["github_url", "https://github.com/test/repo", true], ["github_url", "https://github.com/test", false],
  ["phone", "hello", true], ["phone", "+55 (11) 12345-6789", false],
  ["custom", "Any text", false], ["email", " ", false],
])("validates %s = %s", (key, value, invalid) => expect(!!validateAnswer(key, value)).toBe(invalid));
test("language resolution has no implicit fallback, canonicalizes tags and reports explicit provenance", () => {
  const rows = [{ key: "notice_period", value: "Two weeks" }, { key: "notice_period", value: "Duas semanas", language: "pt-BR" }];
  expect(answerLanguage("pt-br")).toBe("pt-BR");
  expect(() => answerLanguage("bad_tag")).toThrow("language tag");
  expect(() => answerLanguage("")).toThrow("language tag");
  expect(resolveAnswer(rows, "notice_period", "pt-br")).toMatchObject({ value: "Duas semanas", language: "pt-BR", fallback: false });
  expect(resolveAnswer(rows, "notice_period", "en")).toEqual({ status: "missing", fallback: false });
  expect(resolveAnswer(rows, "notice_period", "en", "default")).toMatchObject({ value: "Two weeks", language: "default", fallback: true });
  expect(resolveAnswer(rows, "notice_period", "pt")).toMatchObject({ status: "missing" });
  expect(resolveAnswer(rows, "notice_period")).toMatchObject({ value: "Two weeks" });
  expect(resolveAnswer([{ key: "email", value: "bad" }], "email")).toMatchObject({ status: "invalid" });
});
test("invalid, missing, ambiguous and demographic answers stay distinct and unfilled", () => {
  const result = matchLabels(["Email", "Phone", "First name / Last name", "Gender"], {
    answers: { email: "invalid", phone: " ", first_name: "Taylor", last_name: "Tester", eeo_gender: "Fixture" },
  });
  expect(result.matched).toEqual([]);
  expect(result.unfilled.map(s => s.skip)).toEqual(["invalid-answer", "no-stored-answer", "ambiguous", "eeo-human-only"]);
});
