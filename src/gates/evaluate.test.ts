import { expect, test } from "vitest";
import { evaluateEligibility, evaluateGates, evaluateLanguages, languageKey } from "./evaluate.ts";
import type { EligibilityRequirement, GateProfile, LanguageRequirement } from "./types.ts";

const declared = [{ id: 1, language: "Spanish", level: "Native", notes: null }, { id: 2, language: "English", level: "B1/B2", notes: null }];
const ask = (language: string, bar_above_declared: LanguageRequirement["bar_above_declared"], stated_bar?: string): LanguageRequirement =>
  ({ language, bar_above_declared, quote: `${stated_bar ?? ""} ${language} required`.trim(), ...(stated_bar ? { stated_bar } : {}) });
const silent: EligibilityRequirement = { requires_citizenship_or_pr: false, requires_clearance: false, names_permit_or_sponsors: false, program_confirmed: "unknown" };
const profile = (fields: Partial<GateProfile> = {}): GateProfile => ({ languages: declared, eligibility: "needs_permission", ...fields });

test("language names compare without case, width or spacing differences", () => {
  expect(languageKey("  Brazilian   PORTUGUESE ")).toBe("brazilian portuguese");
  expect(languageKey("Ｅｎｇｌｉｓｈ")).toBe("english");
});

test("the worked example: fluent Russian fails, fluent English flags, Spanish passes", () => {
  expect(evaluateLanguages([ask("Russian", true, "fluent")], declared)).toEqual({
    status: "fail", summary: "Requires a language you do not declare: Russian.",
    findings: [{ verdict: "fail", note: "Requires Russian (fluent), which is not in your languages.", quote: "fluent Russian required" }],
  });
  expect(evaluateLanguages([ask("english", true, "fluent")], declared)).toEqual({
    status: "flag", summary: "The language bar may be above your level: english.",
    findings: [{ verdict: "flag", note: "Requires english (fluent), which may be above your declared B1/B2.", quote: "fluent english required" }],
  });
  expect(evaluateLanguages([ask("Spanish", false)], declared)).toMatchObject({ status: "pass", summary: "Your languages meet the stated requirements.", findings: [{ verdict: "pass", note: "Requires Spanish; you declared Native." }] });
});

test("an unsure level comparison flags, the worst finding wins and no requirement passes", () => {
  expect(evaluateLanguages([ask("English", "unknown", "C1+")], declared).status).toBe("flag");
  expect(evaluateLanguages([ask("Spanish", false), ask("English", true), ask("Polish", false)], declared).status).toBe("fail");
  expect(evaluateLanguages([], declared)).toEqual({ status: "pass", summary: "The job states no language requirement.", findings: [] });
});

test("without declared languages the language gate is off and fails nothing", () => {
  expect(evaluateLanguages([ask("Polish", true)], [])).toEqual({ status: "off", summary: "Add your languages to enable the language gate.", findings: [] });
});

test.each([
  [{ requires_citizenship_or_pr: true }, "fail", false, "Requires citizenship or permanent residency."],
  [{ requires_clearance: true }, "fail", false, "Requires a security clearance, which usually depends on citizenship."],
  [{ requires_citizenship_or_pr: true, names_permit_or_sponsors: true, program_confirmed: true }, "fail", false, "Requires citizenship or permanent residency."],
  [{ names_permit_or_sponsors: true, program_confirmed: true }, "pass", false, "The posting accepts your work permission or sponsors visas."],
  [{}, "pass", true, "The posting is silent on eligibility. Silence is not permission: check the employer's careers or international-applicant page."],
  [{ names_permit_or_sponsors: true, program_confirmed: "unknown" }, "pass", true, "Only a company-wide statement welcomes international applicants. Confirm this role or program is on its list."],
  [{ names_permit_or_sponsors: true, program_confirmed: false }, "flag", false, "The employer's list of roles open to international applicants does not include this one."],
] as const)("a user who needs permission: %j → %s", (fields, status, unverified, summary) => {
  const result = evaluateEligibility({ ...silent, quote: "Eligibility line", ...fields }, "needs_permission");
  expect(result).toMatchObject({ status, unverified, summary });
});

test("both blockers are reported together for a user who needs permission", () => {
  const result = evaluateEligibility({ ...silent, requires_citizenship_or_pr: true, requires_clearance: true, quote: "Citizens with clearance only" }, "needs_permission");
  expect(result.findings.map((finding) => finding.note)).toEqual(["Requires citizenship or permanent residency.", "Requires a security clearance, which usually depends on citizenship."]);
  expect(result.findings.every((finding) => finding.quote === "Citizens with clearance only")).toBe(true);
});

test("a citizen or resident passes citizenship wording and silence, and a clearance flags", () => {
  expect(evaluateEligibility({ ...silent, requires_citizenship_or_pr: true, quote: "Citizens only" }, "citizen_or_resident"))
    .toEqual({ status: "pass", unverified: false, summary: "As a citizen or permanent resident, nothing in the posting excludes you.", findings: [] });
  expect(evaluateEligibility({ ...silent, requires_clearance: true, quote: "Secret clearance" }, "citizen_or_resident")).toMatchObject({
    status: "flag", unverified: false, findings: [{ verdict: "flag", note: "Requires a security clearance. Confirm you hold one or can obtain it.", quote: "Secret clearance" }],
  });
  expect(evaluateEligibility(silent, null)).toEqual({ status: "off", unverified: false, summary: "Set your work eligibility to enable the eligibility gate.", findings: [] });
});

test("the overall verdict is the worst enabled gate; silence and disabled gates pass unverified", () => {
  const at = "2026-11-23T12:00:00.000Z";
  expect(evaluateGates({ languages: [ask("Russian", true)], eligibility: silent }, profile(), at)).toMatchObject({ verdict: "fail", unverified: false, checked_at: at });
  expect(evaluateGates({ languages: [ask("English", true)], eligibility: silent }, profile()).verdict).toBe("flag");
  expect(evaluateGates({ languages: [], eligibility: silent }, profile())).toMatchObject({ verdict: "pass", unverified: true });
  expect(evaluateGates({ languages: [], eligibility: { ...silent, names_permit_or_sponsors: true, program_confirmed: true, quote: "We sponsor visas" } }, profile()))
    .toMatchObject({ verdict: "pass", unverified: false });
  const off = evaluateGates({ languages: [ask("Polish", true)], eligibility: { ...silent, requires_citizenship_or_pr: true, quote: "Citizens only" } }, { languages: [], eligibility: null });
  expect(off).toMatchObject({ verdict: "pass", unverified: true, language: { status: "off" }, eligibility: { status: "off" } });
  expect(evaluateGates({ languages: [ask("Spanish", false)], eligibility: silent }, profile({ eligibility: null }))).toMatchObject({ verdict: "pass", unverified: false });
  expect(typeof evaluateGates({ languages: [], eligibility: silent }, profile()).checked_at).toBe("string");
});
