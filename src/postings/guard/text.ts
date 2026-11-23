/** Text helpers that behave like the Python string methods the guard was written against. */

export const EXCERPT = 120;
export const LINE_MAX = 200;

// Python's str.isspace() set; JavaScript's \s also matches U+FEFF, which the guard counts as a BOM.
const SPACE = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const EDGES = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "g");
// File, group and record separators are line breaks for Python.
// eslint-disable-next-line no-control-regex
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;
// eslint-disable-next-line no-control-regex
const TRAILING_BREAK = /(?:\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])$/;

/** `str.strip()`: Unicode whitespace, but never a BOM. */
export function strip(text: string): string {
  return text.replace(EDGES, "");
}

/** `str.splitlines()`. */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(LINE_BREAK);
  if (TRAILING_BREAK.test(text)) lines.pop();
  return lines;
}

/** The first `count` code points, so a cut never splits a surrogate pair. */
export function cut(text: string, count: number): string {
  return Array.from(text).slice(0, count).join("");
}

/** Collapse runs of spaces and blank lines into what a reader sees. */
export function fold(text: string): string {
  return strip(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/[ \t\xa0\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n"));
}

const WORD_CLASS = String.raw`\p{L}\p{N}_`;
const BOUNDARY = `(?:(?<=[${WORD_CLASS}])(?![${WORD_CLASS}])|(?<![${WORD_CLASS}])(?=[${WORD_CLASS}]))`;

/**
 * Compile a Python `re` pattern with its meaning intact: on str, Python's `\w`
 * and `\b` are Unicode-aware, while JavaScript's are ASCII-only even with `u`.
 */
export function pythonRegex(source: string, flags = "iu"): RegExp {
  let out = "";
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "\\") {
      const next = source[++i] ?? "";
      if (next === "w") out += inClass ? WORD_CLASS : `[${WORD_CLASS}]`;
      else if (next === "b" && !inClass) out += BOUNDARY;
      else out += ch + next;
      continue;
    }
    if (ch === "[" && !inClass) inClass = true;
    else if (ch === "]" && inClass) inClass = false;
    out += ch;
  }
  return new RegExp(out, flags);
}
