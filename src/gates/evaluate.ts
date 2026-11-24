import type {
  CandidateLanguage, EligibilityRequirement, GateEvaluation, GateExtraction, GateFinding, GateProfile, GateResult, LanguageRequirement, Verdict,
} from "./types.ts";

const RANK: Record<Verdict, number> = { pass: 0, flag: 1, fail: 2 };

/** Comparable language name: case, width and spacing do not make two languages differ. */
export function languageKey(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
}

function worst(verdicts: Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((current, next) => (RANK[next] > RANK[current] ? next : current), "pass");
}

function languageFinding(requirement: LanguageRequirement, declared: CandidateLanguage | undefined): GateFinding {
  const name = `${requirement.language}${requirement.stated_bar ? ` (${requirement.stated_bar})` : ""}`;
  const quote = requirement.quote;
  if (!declared) return { verdict: "fail", note: `Requires ${name}, which is not in your languages.`, quote };
  if (requirement.bar_above_declared === false) return { verdict: "pass", note: `Requires ${name}; you declared ${declared.level}.`, quote };
  return { verdict: "flag", note: `Requires ${name}, which may be above your declared ${declared.level}.`, quote };
}

/**
 * Language gate. The language the posting is written in is not a requirement;
 * only what the job asks for counts. An undeclared language is a hard no.
 */
export function evaluateLanguages(requirements: LanguageRequirement[], languages: CandidateLanguage[]): GateResult {
  if (!languages.length) return { status: "off", summary: "Add your languages to enable the language gate.", findings: [] };
  if (!requirements.length) return { status: "pass", summary: "The job states no language requirement.", findings: [] };
  const byKey = new Map(languages.map((language) => [languageKey(language.language), language]));
  const findings = requirements.map((requirement) => languageFinding(requirement, byKey.get(languageKey(requirement.language))));
  const status = worst(findings.map((finding) => finding.verdict));
  const names = (verdict: Verdict) => findings.flatMap((finding, i) => (finding.verdict === verdict ? [requirements[i]!.language] : [])).join(", ");
  const summary = status === "fail" ? `Requires a language you do not declare: ${names("fail")}.`
    : status === "flag" ? `The language bar may be above your level: ${names("flag")}.`
      : "Your languages meet the stated requirements.";
  return { status, summary, findings };
}

function permissionFinding(requirement: EligibilityRequirement): GateFinding & { unverified: boolean } {
  const quote = requirement.quote;
  if (!requirement.names_permit_or_sponsors)
    return { verdict: "pass", unverified: true, note: "The posting is silent on eligibility. Silence is not permission: check the employer's careers or international-applicant page." };
  if (requirement.program_confirmed === true)
    return { verdict: "pass", unverified: false, note: "The posting accepts your work permission or sponsors visas.", quote };
  if (requirement.program_confirmed === false)
    return { verdict: "flag", unverified: false, note: "The employer's list of roles open to international applicants does not include this one.", quote };
  return { verdict: "pass", unverified: true, note: "Only a company-wide statement welcomes international applicants. Confirm this role or program is on its list.", quote };
}

function blockers(requirement: EligibilityRequirement, verdict: Verdict): GateFinding[] {
  const quote = requirement.quote;
  return [
    ...(requirement.requires_citizenship_or_pr && verdict === "fail" ? [{ verdict, note: "Requires citizenship or permanent residency.", quote }] : []),
    ...(requirement.requires_clearance
      ? [{ verdict, quote, note: verdict === "fail" ? "Requires a security clearance, which usually depends on citizenship." : "Requires a security clearance. Confirm you hold one or can obtain it." }]
      : []),
  ];
}

/**
 * Eligibility gate. A citizenship, residency or clearance requirement fails a
 * user who needs permission to work; a posting that is silent passes unverified.
 */
export function evaluateEligibility(requirement: EligibilityRequirement, eligibility: GateProfile["eligibility"]): GateResult & { unverified: boolean } {
  if (!eligibility) return { status: "off", unverified: false, summary: "Set your work eligibility to enable the eligibility gate.", findings: [] };
  if (eligibility === "citizen_or_resident") {
    const findings = blockers(requirement, "flag");
    return findings.length
      ? { status: "flag", unverified: false, summary: "The job requires a security clearance.", findings }
      : { status: "pass", unverified: false, summary: "As a citizen or permanent resident, nothing in the posting excludes you.", findings: [] };
  }
  const findings = blockers(requirement, "fail");
  if (findings.length) return { status: "fail", unverified: false, summary: findings.map((finding) => finding.note).join(" "), findings };
  const { unverified, ...finding } = permissionFinding(requirement);
  return { status: finding.verdict, unverified, summary: finding.note, findings: [finding] };
}

/** Both gates for one job. Gates the user has not enabled never fail a job. */
export function evaluateGates(extraction: GateExtraction, profile: GateProfile, checkedAt = new Date().toISOString()): GateEvaluation {
  const language = evaluateLanguages(extraction.languages, profile.languages);
  const { unverified, ...eligibility } = evaluateEligibility(extraction.eligibility, profile.eligibility);
  const enabled = [language, eligibility].flatMap((gate) => (gate.status === "off" ? [] : [gate.status]));
  const verdict = worst(enabled);
  return { verdict, unverified: verdict === "pass" && (unverified || !enabled.length), language, eligibility, checked_at: checkedAt };
}
