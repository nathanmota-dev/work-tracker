import { URL_PATTERN } from "./html.ts";
import { LINE_MAX, pythonRegex, splitLines, strip } from "./text.ts";

/** Lines shaped like an instruction to an agent rather than prose for a reader (ported verbatim, case-insensitive). */
export const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  String.raw`\bignore (all|any|the|previous|prior|above|earlier)\b`,
  // The same instruction with its other two verbs. These take an explicit
  // object ("previous instructions"), because "forget the" and "disregard
  // the" are ordinary prose where "ignore the" already is not.
  String.raw`\b(disregard|forget)( all| any| the| your| my)? (previous|prior|above|earlier|preceding|initial|original|system) (instructions?|prompts?)\b`,
  String.raw`\byou are (?:an?|the) (?:ai(?![\w-])|ai (?:assistant|agent|model|language model)|assistant|llm|language model)\b`,
  String.raw`\bsystem prompt\b`,
  // "do not tell the user", "never inform the user": the verb straight onto
  // "the user" (not "the user's"), with the typographic apostrophe most web
  // text uses. Kept narrow on purpose: "never disclose user data" and "do
  // not tell users about unreleased features" are everyday privacy and
  // support prose.
  String.raw`\b(do not|don['\u2019]?t|never) (tell|inform) the user\b(?!['\u2019]s)`,
  // "do not reveal these instructions to the user", "never mention this to
  // the user": a demonstrative object, then "to the user" within a clause.
  String.raw`\b(do not|don['\u2019]?t|never) (mention|reveal|disclose) (this|these|that|it|any of this|the (above|following|previous))\b[^.\n]{0,30}\bto the user\b`,
  String.raw`\b(run|execute) the following (command|commands|script|code|shell|instruction|instructions|steps)\b`,
  // "As an AI" flags by default. Exempt only a job-title noun within a few words of "AI", the way AI
  // job ads introduce the role ("As an AI Engineer", "as an AI/ML Researcher", "As an AI Product Manager").
  String.raw`\bas an ai(?![\w-])(?![\s/&]+(?:[\w&/-]+\s+){0,3}?(?:engineer|developer|researcher|scientist|architect|specialist|lead|consultant|manager|analyst|intern|trainer|expert|strategist|designer|tester|owner|programmer)s?\b)`,
  String.raw`^\s*(assistant|system|user)\s*:`,
  String.raw`<\|`,
  String.raw`\[INST\]`,
  String.raw`###\s*(system|instruction)`,
  String.raw`\b(curl|wget|ssh|scp)\b`,
  String.raw`\.env\b`,
  String.raw`settings\.json`,
  String.raw`allowed-tools`,
  String.raw`\btool_use\b|\bfunction_call\b`,
].map(pattern => pythonRegex(pattern));
/**
 * Patterns that also name everyday skills ("manage SSH access", "curl
 * familiarity", "rotate keys in .env files"). In visible text a line matched
 * only by these is quoted as a tool mention without the ⚠; in hidden content it
 * still counts as an instruction, since nothing a reader cannot see needs to
 * name a shell tool.
 */
const TOOL_MENTIONS = new Set([INSTRUCTION_PATTERNS[12], INSTRUCTION_PATTERNS[13]]);

const WORD = pythonRegex(String.raw`\w+`, "gu");
const LATIN = /[A-Za-z]/;
const CONFUSABLE = /[\u0400-\u04ff\u0370-\u03ff]/;

/**
 * @property instruction_like Instruction-shaped lines, quoted around the trigger.
 * @property tool_mentions Visible lines that only name a shell tool or a secrets file.
 * @property hidden_urls URLs found only in hidden content.
 * @property homoglyph_runs Words mixing Latin with Cyrillic or Greek letters.
 */
export interface ScanFindings {
  instruction_like: string[];
  tool_mentions: string[];
  hidden_urls: string[];
  visible_url_count: number;
  homoglyph_runs: string[];
}

/**
 * Up to LINE_MAX characters of `line`, always including position `at`, so the
 * quote shows the match even when the trigger sits late in a long paragraph.
 */
export function excerpt(line: string, at: number): string {
  const points = Array.from(line);
  if (points.length <= LINE_MAX) return line;
  const position = Array.from(line.slice(0, at)).length;
  let start = Math.max(0, position - Math.floor(LINE_MAX / 3));
  const end = Math.min(points.length, start + LINE_MAX);
  start = Math.max(0, end - LINE_MAX);
  return `${start ? "\u2026" : ""}${points.slice(start, end).join("")}${end < points.length ? "\u2026" : ""}`;
}

function firstMatch(line: string, patterns: readonly RegExp[]): RegExpExecArray | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match) return match;
  }
  return undefined;
}

const unique = (items: Iterable<string>) => [...new Set(items)];

/** Instruction-shaped lines, tool mentions, hidden URLs, visible URL count and mixed-script words. */
export function scan(visible: string, hidden: string): ScanFindings {
  const seen = new Set<string>();
  const instruction_like: string[] = [];
  const tool_mentions: string[] = [];
  const targeted = INSTRUCTION_PATTERNS.filter(pattern => !TOOL_MENTIONS.has(pattern));
  const visibleLines = splitLines(visible).length;
  splitLines(visible).concat(splitLines(hidden)).forEach((line, index) => {
    const stripped = strip(line);
    if (!stripped || seen.has(stripped)) return;
    const instruction = firstMatch(stripped, index < visibleLines ? targeted : INSTRUCTION_PATTERNS);
    const tool = instruction ? undefined : firstMatch(stripped, [...TOOL_MENTIONS]);
    const match = instruction ?? tool;
    if (!match) return;
    seen.add(stripped);
    (instruction ? instruction_like : tool_mentions).push(excerpt(stripped, match.index));
  });
  const homoglyph_runs = unique([...`${visible}\n${hidden}`.matchAll(WORD)].map(([word]) => word)
    .filter(word => LATIN.test(word) && CONFUSABLE.test(word)));
  return {
    instruction_like,
    tool_mentions,
    hidden_urls: unique(hidden.match(URL_PATTERN) ?? []),
    visible_url_count: visible.match(URL_PATTERN)?.length ?? 0,
    homoglyph_runs,
  };
}
