import { expect, test } from "vitest";
import { parseExtraction } from "./extraction.ts";

const silent = { requires_citizenship_or_pr: false, requires_clearance: false, names_permit_or_sponsors: false };

test("keeps the extraction, trims text and defaults an absent program confirmation to unknown", () => {
  expect(parseExtraction({
    languages: [{ language: "  Russian ", stated_bar: " fluent ", bar_above_declared: true, quote: " Fluent   Russian\nrequired. " }, { language: "Spanish", stated_bar: " ", bar_above_declared: "unknown", quote: "Spanish" }],
    eligibility: { ...silent, quote: "  " },
  })).toEqual({
    languages: [{ language: "Russian", stated_bar: "fluent", bar_above_declared: true, quote: "Fluent Russian required." }, { language: "Spanish", bar_above_declared: "unknown", quote: "Spanish" }],
    eligibility: { ...silent, program_confirmed: "unknown" },
  });
  expect(parseExtraction({ languages: [], eligibility: { ...silent, names_permit_or_sponsors: true, program_confirmed: false, quote: "We welcome international applicants" } }).eligibility)
    .toEqual({ ...silent, names_permit_or_sponsors: true, program_confirmed: false, quote: "We welcome international applicants" });
});

test.each([
  [null, 'must be a JSON object with "languages" and "eligibility"'],
  [[], "must be a JSON object"],
  [{ eligibility: silent }, 'needs a "languages" array'],
  [{ languages: [] }, 'needs an "eligibility" object'],
  [{ languages: ["English"], eligibility: silent }, 'languages[0] needs a "language" name'],
  [{ languages: [{ language: "x".repeat(61), bar_above_declared: true, quote: "q" }], eligibility: silent }, "longer than 60 characters"],
  [{ languages: [{ language: "Polish", bar_above_declared: "maybe", quote: "q" }], eligibility: silent }, '"bar_above_declared" must be true, false or "unknown"'],
  [{ languages: [{ language: "Polish", bar_above_declared: true }], eligibility: silent }, 'languages[0] (Polish) needs the literal posting text in "quote"'],
  [{ languages: [{ language: "Polish", bar_above_declared: true, quote: "q".repeat(501) }], eligibility: silent }, "longer than 500 characters"],
  [{ languages: [], eligibility: { ...silent, requires_clearance: "yes" } }, "eligibility.requires_clearance must be true or false"],
  [{ languages: [], eligibility: { ...silent, program_confirmed: "maybe" } }, "eligibility.program_confirmed must be"],
  [{ languages: [], eligibility: { ...silent, requires_citizenship_or_pr: true } }, 'eligibility (requires_citizenship_or_pr is true) needs the literal posting text in "quote"'],
  [{ languages: [], eligibility: { ...silent, names_permit_or_sponsors: true, quote: "   " } }, "eligibility (names_permit_or_sponsors is true) needs the literal"],
])("rejects %j with a clear message", (value, message) => {
  expect(() => parseExtraction(value)).toThrow(message);
});
