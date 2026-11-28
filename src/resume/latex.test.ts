import { expect, test } from "vitest";
import { displayUrl, latexText, latexUrl, resumeDate, resumePeriod } from "./latex.ts";

test("escapes every LaTeX special character and flattens control characters", () => {
  expect(latexText("C# & .NET 100% $5 a_b {x} ~ ^ \\")).toBe("C\\# \\& .NET 100\\% \\$5 a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}");
  expect(latexText(" line\none\ttab ")).toBe("line one tab");
});

test("keeps only http(s) and mailto links that LaTeX can hold, escaping % and #", () => {
  expect(latexUrl("https://example.com/a%20b#top")).toBe("https://example.com/a\\%20b\\#top");
  expect(latexUrl("mailto:me@example.com")).toBe("mailto:me@example.com");
  for (const url of ["javascript:alert(1)", "#", "ftp://example.com", "https://example.com/{x}", "https://a b.com"]) expect(latexUrl(url)).toBe("");
});

test("shows a link without protocol, www or trailing slash", () => {
  expect(displayUrl("https://www.linkedin.com/in/someone/")).toBe("linkedin.com/in/someone");
  expect(displayUrl("http://github.com/someone")).toBe("github.com/someone");
});

test("writes dates and periods the way the resume reads them", () => {
  expect(resumeDate("2025-07")).toBe("07/2025");
  expect(resumeDate("2019")).toBe("2019");
  expect(resumeDate("Present")).toBe("Atual");
  expect(resumeDate("")).toBe("");
  expect(resumePeriod("2025-07", "Present")).toBe("07/2025 -- Atual");
  expect(resumePeriod("2015-01", "")).toBe("01/2015");
  expect(resumePeriod("", "")).toBe("");
});
