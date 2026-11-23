import { GateError, type EligibilityRequirement, type GateExtraction, type LanguageRequirement } from "./types.ts";

const MAX_QUOTE = 500;
const MAX_NAME = 60;
const ELIGIBILITY_FLAGS = ["requires_citizenship_or_pr", "requires_clearance", "names_permit_or_sponsors"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Trimmed text with runs of whitespace collapsed; empty when absent. */
export function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function quoteOf(value: unknown, what: string): string {
  const quote = clean(value);
  if (!quote) throw new GateError(`${what} needs the literal posting text in "quote": copy the line that states it.`);
  if (quote.length > MAX_QUOTE) throw new GateError(`${what}: "quote" is longer than ${MAX_QUOTE} characters; quote only the requirement line.`);
  return quote;
}

function language(value: unknown, index: number): LanguageRequirement {
  const item = record(value);
  const name = clean(item?.language);
  const label = `languages[${index}]`;
  if (!item || !name) throw new GateError(`${label} needs a "language" name.`);
  if (name.length > MAX_NAME) throw new GateError(`${label}: "language" is longer than ${MAX_NAME} characters.`);
  const bar = item.bar_above_declared;
  if (bar !== true && bar !== false && bar !== "unknown")
    throw new GateError(`${label} (${name}): "bar_above_declared" must be true, false or "unknown".`);
  const stated = clean(item.stated_bar);
  return { language: name, ...(stated ? { stated_bar: stated } : {}), bar_above_declared: bar, quote: quoteOf(item.quote, `${label} (${name})`) };
}

function eligibility(value: unknown): EligibilityRequirement {
  const item = record(value);
  if (!item) throw new GateError('The extraction needs an "eligibility" object (all flags false when the posting is silent).');
  for (const flag of ELIGIBILITY_FLAGS)
    if (typeof item[flag] !== "boolean") throw new GateError(`eligibility.${flag} must be true or false.`);
  const confirmed = item.program_confirmed ?? "unknown";
  if (confirmed !== true && confirmed !== false && confirmed !== "unknown")
    throw new GateError('eligibility.program_confirmed must be true, false or "unknown".');
  const weighs = ELIGIBILITY_FLAGS.find((flag) => item[flag] === true);
  const quote = weighs ? quoteOf(item.quote, `eligibility (${weighs} is true)`) : clean(item.quote);
  return {
    requires_citizenship_or_pr: item.requires_citizenship_or_pr as boolean,
    requires_clearance: item.requires_clearance as boolean,
    names_permit_or_sponsors: item.names_permit_or_sponsors as boolean,
    program_confirmed: confirmed,
    ...(quote ? { quote } : {}),
  };
}

/**
 * Validate the skill's extraction for one job. Every item that weighs on the
 * verdict must quote the posting, so the user can see what it rests on.
 */
export function parseExtraction(value: unknown): GateExtraction {
  const item = record(value);
  if (!item) throw new GateError("The extraction must be a JSON object with \"languages\" and \"eligibility\".");
  if (!Array.isArray(item.languages)) throw new GateError('The extraction needs a "languages" array (empty when the job requires no language).');
  return { languages: item.languages.map(language), eligibility: eligibility(item.eligibility) };
}
