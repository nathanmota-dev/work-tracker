/**
 * Integrity guard for third-party job posting text, ported from ai-job-search's
 * `tools/posting_guard.py`. A posting is read by agents that also see the
 * candidate's profile, reusable answers and a signed-in browser, so the obvious
 * payload classes are made visible deterministically before any agent reads it:
 *
 *   - hidden HTML (display:none, visibility:hidden, opacity:0, font-size:0,
 *     color:transparent, clip/clip-path, off-screen positioning, a collapsed box
 *     with overflow:hidden, the `hidden` attribute, aria-hidden) is removed and
 *     reported; comments and script/style/noscript/svg/template blocks are
 *     removed and scanned but not listed, since every page has them;
 *   - invisible characters are removed and counted; tampering ones (zero-width
 *     inside a word, bidi overrides and isolates) are flagged;
 *   - Unicode tag characters are removed and always flagged, except in the three
 *     UK subdivision flags; text spelled in tag characters or variation
 *     selectors is decoded and scanned like hidden content;
 *   - instruction-shaped lines are quoted, never removed;
 *   - URLs that exist only in hidden content and mixed-script words are listed.
 *
 * Removal is the defense: hidden content never reaches the cleaned text. The ⚠
 * is for the user and fires only on signals of targeting; hidden blocks and
 * hidden URLs are context, because navigation chrome is hidden on nearly every
 * real page. The guard advises; it never blocks.
 */
import { HTML_HINT, cleanHtml } from "./html.ts";
import { cleanText, type InvisibleFindings } from "./invisible.ts";
import { scan, type ScanFindings } from "./scan.ts";

export { INSTRUCTION_PATTERNS } from "./scan.ts";
export { EXCERPT, LINE_MAX } from "./text.ts";

export type PostingFindings = InvisibleFindings & ScanFindings & { hidden_blocks: string[] };
/**
 * @property text Cleaned text: the only version of the posting an agent may read.
 * @property verdict One short English line for the user.
 * @property flagged True when the verdict carries ⚠.
 */
export interface PostingGuardResult {
  text: string;
  findings: PostingFindings;
  verdict: string;
  flagged: boolean;
}
export type GuardMode = "auto" | "html" | "text";

export const CLEAN_VERDICT = "Posting check: clean";
export const NO_TEXT_VERDICT = "Posting check: refused (no text to evaluate)";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function alarms(findings: PostingFindings): string[] {
  return ([
    [findings.instruction_like.length, "instruction-shaped line", "instruction-shaped lines"],
    [findings.invisible_flagged, "invisible character inside words", "invisible characters inside words"],
    [findings.invisible_chars.tag ?? 0, "tag character (text hidden from the reader)", "tag characters (text hidden from the reader)"],
    [findings.invisible_text.length, "string spelled in invisible characters", "strings spelled in invisible characters"],
    [findings.homoglyph_runs.length, "mixed-script word", "mixed-script words"],
  ] as const).filter(([count]) => count > 0).map(([count, one, many]) => plural(count, one, many));
}

function context(findings: PostingFindings): string[] {
  const removed = ([
    [findings.hidden_blocks.length, "hidden block", "hidden blocks"],
    [findings.hidden_urls.length, "hidden URL", "hidden URLs"],
  ] as const).filter(([count]) => count > 0).map(([count, one, many]) => plural(count, one, many));
  const parts = removed.length ? [`${removed.join(" and ")} removed`] : [];
  if (findings.tool_mentions.length) parts.push(`${plural(findings.tool_mentions.length, "tool mention", "tool mentions")} quoted`);
  return parts;
}

/** The one-line verdict: ⚠ only on targeting signals, with removals as context. */
export function postingVerdict(findings: PostingFindings): string {
  const alarm = alarms(findings);
  const notes = context(findings);
  const suffix = notes.length ? ` (${notes.join("; ")})` : "";
  if (alarm.length) return `Posting check ⚠: ${alarm.join(", ")} - review before continuing${suffix}`;
  return CLEAN_VERDICT + suffix;
}

/** Clean and scan a posting. Input with no text to evaluate gets the refused verdict, never an exception. */
export function guardPosting(raw: string, mode: GuardMode = "auto"): PostingGuardResult {
  const html = mode === "html" || (mode === "auto" && HTML_HINT.test(raw));
  const parsed = html ? cleanHtml(raw) : { text: raw, hiddenBlocks: [], hiddenText: "" };
  const visible = cleanText(parsed.text);
  const hidden = cleanText(parsed.hiddenText);
  // Invisible characters inside hidden content count and alarm like visible ones;
  // what they spell is hidden content: scanned and reported, never cleaned text.
  const invisible: InvisibleFindings = {
    invisible_chars: { ...visible.findings.invisible_chars },
    invisible_flagged: visible.findings.invisible_flagged + hidden.findings.invisible_flagged,
    invisible_text: [...visible.findings.invisible_text, ...hidden.findings.invisible_text],
  };
  for (const [key, count] of Object.entries(hidden.findings.invisible_chars))
    invisible.invisible_chars[key] = (invisible.invisible_chars[key] ?? 0) + count;
  const hiddenText = [hidden.text, ...invisible.invisible_text].join("\n");
  const findings: PostingFindings = { hidden_blocks: parsed.hiddenBlocks, ...invisible, ...scan(visible.text, hiddenText) };
  const verdict = postingVerdict(findings);
  return {
    text: visible.text,
    findings,
    verdict: !visible.text && verdict === CLEAN_VERDICT ? NO_TEXT_VERDICT : verdict,
    flagged: verdict.startsWith("Posting check ⚠"),
  };
}
