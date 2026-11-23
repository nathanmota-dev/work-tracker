import { LINE_MAX, cut, fold, strip } from "./text.ts";

export const ZERO_WIDTH = "\u200b\u200c\u200d\u2060\u2061\u2062\u2063\u2064";
export const BIDI = "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069";
const BIDI_TAMPER = "\u202d\u202e\u2066\u2067\u2068\u2069"; // overrides and isolates
const FORMAT = "\u00ad\u2028\u2029"; // soft hyphen, line/paragraph separators
const BOM = "\ufeff";
// U+E0000-U+E007F: the Unicode "tags" block, one invisible code point per ASCII
// character. A payload written in it survives copy-paste, never renders, and is
// decoded by a model as if it were the ASCII it mirrors ("ASCII smuggling"); a
// single one inside "ignore" also splits the word past every instruction pattern.
const INVISIBLE = new Set(ZERO_WIDTH + BIDI + FORMAT + BOM);
const isTag = (ch: string) => ch.codePointAt(0)! >= 0xe0000 && ch.codePointAt(0)! <= 0xe007f;
const dropInvisible = (text: string) => Array.from(text).filter(ch => !INVISIBLE.has(ch) && !isTag(ch)).join("");
const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;
// The one legitimate use of tag characters: the England, Scotland and Wales flags
// (black flag, tag letters gbeng/gbsct/gbwls, cancel tag). Matched in full and left
// intact; a payload inside a well-formed tag sequence, extra tags after a valid
// flag, or a non-RGI subdivision still count and alarm.
const RGI_TAG_FLAG = /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu;
// Variation selectors pick a glyph variant and render as nothing on their own; a
// run of them carries one byte each. A lone one (the VS16 after a heart emoji) is encoding
// noise; a run is a payload.
const VARIATION = /[\ufe00-\ufe0f\u{E0100}-\u{E01EF}]/gu;
const VARIATION_RUN = /[\ufe00-\ufe0f\u{E0100}-\u{E01EF}]{2,}/gu;
const LETTER = /^\p{L}$/u;
const PRINTABLE = /^(?: |[^\p{C}\p{Z}])$/u;

/**
 * @property invisible_chars Removed characters per category (`zero_width`, `bidi`,
 *   `format`, `bom`, `tag`, `variation`).
 * @property invisible_flagged Characters that indicate tampering.
 * @property invisible_text What runs of tag characters or variation selectors spell.
 */
export interface InvisibleFindings {
  invisible_chars: Record<string, number>;
  invisible_flagged: number;
  invisible_text: string[];
}

const occurrences = (text: string, chars: string) => {
  let count = 0;
  for (const ch of text) if (chars.includes(ch)) count++;
  return count;
};

/** A zero-width or BOM character between two letters splits a word to dodge a scan. */
function tampering(text: string): number {
  const points = Array.from(text);
  let flagged = 0;
  points.forEach((ch, index) => {
    if (BIDI_TAMPER.includes(ch)) flagged++;
    else if ((ZERO_WIDTH.includes(ch) || ch === BOM) && LETTER.test(points[index - 1] ?? "") && LETTER.test(points[index + 1] ?? "")) flagged++;
  });
  return flagged;
}

function decodeRuns(text: string, unflagged: string): string[] {
  const decoded: string[] = [];
  for (const [run] of unflagged.matchAll(TAG_RUN)) {
    const ascii = strip(Array.from(run).map(ch => ch.codePointAt(0)! - 0xe0000)
      .filter(code => code >= 0x20 && code < 0x7f).map(code => String.fromCharCode(code)).join(""));
    if (ascii) decoded.push(cut(ascii, LINE_MAX));
  }
  for (const [run] of text.matchAll(VARIATION_RUN)) {
    const bytes = Uint8Array.from(Array.from(run), ch => {
      const code = ch.codePointAt(0)!;
      return code <= 0xfe0f ? code - 0xfe00 : code - 0xe0100 + 16;
    });
    const value = strip(Array.from(new TextDecoder().decode(bytes)).filter(ch => PRINTABLE.test(ch)).join(""));
    if (value) decoded.push(cut(value, LINE_MAX));
  }
  return decoded;
}

/** Remove invisible characters, keeping the legitimate flag emoji intact. */
function stripInvisible(text: string): string {
  let kept = "";
  let last = 0;
  for (const match of text.matchAll(RGI_TAG_FLAG)) {
    kept += dropInvisible(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return kept + dropInvisible(text.slice(last));
}

/**
 * Remove invisible characters. The flagged count covers a zero-width or BOM
 * character between two letters and any bidi override or isolate. A BOM at
 * offset 0, emoji joiners, RTL marks, soft hyphens, emoji flag tags and a lone
 * variation selector are counted but not flagged: they are encoding noise, not
 * tampering. Tag character runs and variation selector runs are decoded into
 * `invisible_text` instead, since what they spell is the payload.
 */
export function cleanText(text: string): { text: string; findings: InvisibleFindings } {
  const counts: Record<string, number> = {};
  for (const [key, chars] of [["zero_width", ZERO_WIDTH], ["bidi", BIDI], ["format", FORMAT], ["bom", BOM]] as const) {
    const count = occurrences(text, chars);
    if (count) counts[key] = count;
  }
  const unflagged = text.replace(RGI_TAG_FLAG, "");
  const tags = Array.from(unflagged).filter(isTag).length;
  if (tags) counts.tag = tags;
  const variation = text.match(VARIATION)?.length ?? 0;
  if (variation) counts.variation = variation;
  const findings = { invisible_chars: counts, invisible_flagged: tampering(text), invisible_text: decodeRuns(text, unflagged) };
  return { text: fold(stripInvisible(text.replace(VARIATION, ""))), findings };
}
