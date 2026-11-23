import { describe, expect, test } from "vitest";
import { findNonAsciiDateRanges, normalizeText, textLayerFindings, textLayerWarnings } from "./text-layer.ts";

describe("normalizeText", () => {
  test.each([
    ["Master\u2019s degree", "Master's degree"],
    ["\u2018quoted\u2019", "'quoted'"],
    ["\u201cSix Sigma\u201d", "\"Six Sigma\""],
    ["2016\u20132024", "2016-2024"],
    ["role\u2014title", "role-title"],
    ["EUR\u00a0600k", "EUR 600k"],
    ["Professional\n   Experience ", "Professional Experience"],
    ["Cafe\u0301", "Caf\u00e9"],
  ])("folds %j", (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
  test("the fold is symmetric", () => {
    expect(normalizeText("Master\u2019s")).toBe(normalizeText("Master's"));
  });
});

describe("findNonAsciiDateRanges", () => {
  const count = (text: string) => findNonAsciiDateRanges(text).length;
  test("reports an en dash between years with its code point", () => {
    expect(findNonAsciiDateRanges("Six Sigma Green Belt, 2016\u20132024.\n")).toEqual([{ line: "Six Sigma Green Belt, 2016\u20132024.", dash: "\u2013" }]);
  });
  test("ASCII hyphen ranges are clean", () => {
    expect(findNonAsciiDateRanges("2016-2024\nMar 2016 - Jul 2016\n")).toEqual([]);
  });
  test.each(["Mar 2016 \u2013 Jul 2016", "2016 \u2013 Present", "\u2013 2024", "1988 \u2013 1994"])("a year on either side is enough (%j)", text => {
    expect(count(text)).toBe(1);
  });
  test.each(["\u2010", "\u2011", "\u2012", "\u2014", "\u2015", "\u2212"])("other dashes and the minus sign are caught (%j)", dash => {
    expect(findNonAsciiDateRanges(`2016${dash}2024`)[0]!.dash).toBe(dash);
  });
  test.each([
    "EUR 600k\u20131M, 12\u201315 people",
    "Grew budget DKK 120000\u2013200000",
    "Scaled ingestion from 12000\u201315000 events/s",
    "Salary EUR 1500\u20132000 per month",
    "Scaled the API to serve 2000\u20135000 requests per second",
    "Budget 1.5\u20132.0M, headcount 20\u201325",
    "items 17\u20132016",
    ...["\u20ac", "\u00a3", "$", "\u00a5"].flatMap(symbol => [`Budget ${symbol}2000\u2013${symbol}5000 per month`, `Budget 1500${symbol}\u20132000${symbol} per month`, `Budget ${symbol}2000\u2013${symbol}2024 per month`]),
    "Heading 1988-1994\n\u2013 note\n",
    "Six Sigma \u2013\n2016 onwards\n",
  ])("quantities and dashes on another line are not dates (%j)", text => {
    expect(findNonAsciiDateRanges(text)).toEqual([]);
  });
  test.each([
    "03/2016\u201307/2024", "01.2016 \u2013 12.2024", "2016-03\u20132024-07", "2016/17\u20132018/19",
    "01.03.2016\u201331.07.2024", "2016\u201307/2024", "MSc Physics, 2016\u201317", "2019\u201320 season",
    "2016 \u2013 17", "1990\u20132010 programme", "Roles 2000\u20132024", "Since $2000\u2013Present",
  ])("numerically formatted dates and year pairs are caught (%j)", text => {
    expect(count(text)).toBe(1);
  });
  test("a standalone year next to a longer number is still caught, in document order", () => {
    expect(findNonAsciiDateRanges("2016\u20132024 (120000 users)")[0]!.dash).toBe("\u2013");
    expect(findNonAsciiDateRanges("2016\u20132024 role\nmore text\nJan 2010 \u2013 Dec 2012 degree\n").map(hit => hit.line)).toEqual(["2016\u20132024 role", "Jan 2010 \u2013 Dec 2012 degree"]);
  });
});

describe("textLayerFindings", () => {
  const resume = "Ada Lovelace\nada@example.com | +55 (11) 98765-4321\nEngineer 2020-2024\n";
  test("a clean text layer has no findings, with or without an identity", () => {
    expect(textLayerFindings(resume, { email: "ADA@example.com", phone: "+55 11 98765-4321" })).toEqual([]);
    expect(textLayerFindings(resume)).toEqual([]);
    expect(textLayerFindings("(11) 98765-4321", { phone: "+55 11 98765-4321" })).toEqual([]);
    expect(textLayerFindings("no digits", { email: " ", phone: "n/a" })).toEqual([]);
  });
  test("flags private-use glyphs and replacement characters", () => {
    expect(textLayerWarnings("\uf0e0 ada@example.com \uf095 \uf0e0 caf\ufffd")).toEqual([
      "The text layer has 3 private-use glyph(s) (U+F0E0, U+F095), usually font icons that an ATS cannot read.",
      "The text layer has 1 replacement character(s) (U+FFFD): some text could not be extracted.",
    ]);
  });
  test("flags an email or phone that is not present as text", () => {
    expect(textLayerWarnings("\uf0e0 \uf095 Ada", { email: "ada@example.com", phone: "+55 11 98765-4321" })).toEqual([
      expect.stringContaining("private-use"),
      "The text layer does not contain your email (ada@example.com) as text.",
      "The text layer does not contain your phone (+55 11 98765-4321) as text.",
    ]);
    expect(textLayerFindings("call 4321", { phone: "4321" })).toEqual([]);
    expect(textLayerFindings("call 1234", { phone: "4321" }).map(finding => finding.code)).toEqual(["missing-phone"]);
  });
  test("groups date ranges joined by a non-ASCII dash per code point", () => {
    expect(textLayerFindings("Jan 2024 \u2013 Atual\n2016\u20132018\n2019\u20142020\n")).toEqual([
      { code: "date-dash:U+2013", message: "2 date ranges use a non-ASCII dash (U+2013 in \u201cJan 2024 \u2013 Atual\u201d, \u201c2016\u20132018\u201d); some ATS, such as Workday, drop these dates. Use an ASCII hyphen." },
      { code: "date-dash:U+2014", message: "A date range uses a non-ASCII dash (U+2014 in \u201c2019\u20142020\u201d); some ATS, such as Workday, drop these dates. Use an ASCII hyphen." },
    ]);
  });
});
