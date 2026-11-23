import { decodeEntities } from "./entities.ts";
import { cleanText } from "./invisible.ts";
import { EXCERPT, cut, fold, pythonRegex } from "./text.ts";

export const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;
export const HTML_HINT = pythonRegex(String.raw`<\s*(html|body|div|p)\b`);

const HIDDEN_STYLE = pythonRegex(
  "(?:^|;)\\s*(?:display\\s*:\\s*none"
  + "|visibility\\s*:\\s*(?:hidden|collapse)"
  + "|opacity\\s*:\\s*0(?![.\\d]*[1-9])"
  + "|font-size\\s*:\\s*(?:0(?:\\.0+)?(?:px|pt|em|rem|%)?(?![\\d.])|[012](?:\\.\\d+)?px(?![\\w.%]))"
  + "|transform\\s*:[^;]*\\bscale(?:[XYZ]|3d)?\\(\\s*0(?![.\\d]*[1-9])"
  + "|color\\s*:\\s*transparent"
  + "|clip\\s*:\\s*rect\\(\\s*0"
  + "|clip-path\\s*:\\s*inset\\(\\s*(?:100%|(?:5\\d|[6-9]\\d|100)(?:\\.\\d+)?%\\s*\\))"
  + "|(?:(?:margin-)?(?:left|top)|text-indent)\\s*:\\s*-(?:99\\d+|\\d{4,})(?:px|em|rem))",
);
const PRESTRIP = /<!DOCTYPE[^>]*>|<\?[^>]*\?>/gi;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const DROP_BLOCKS = pythonRegex(String.raw`<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)`, "giu");
const TAG = pythonRegex(String.raw`<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>`, "gu");
const ATTR = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
// A box collapsed to nothing with its overflow clipped hides its content as surely
// as display:none. Either half alone is everyday layout CSS, so both must be present.
const COLLAPSED_BOX = pythonRegex(String.raw`\b(?:max-)?(?:height|width)\s*:\s*0(?:\.0+)?(?:px|em|rem|%|pt)?(?![\d.])`);
const CLIPPED = pythonRegex(String.raw`\boverflow(?:-[xy])?\s*:\s*hidden\b`);
const VOID = new Set("br img input meta link hr wbr source area base col embed param track".split(" "));
const BLOCK = new Set(("p div li ul ol h1 h2 h3 h4 h5 h6 tr br section article header footer table thead tbody blockquote "
  + "pre dd dt dl nav main aside figure form fieldset legend address hr td th option").split(" "));
const IMPLIED_END = new Set("p li dd dt tr td th option".split(" ")); // an open one is closed by a sibling
const CLOSES_P = new Set([...BLOCK].filter(name => name !== "br")); // an open <p> is closed by any block-level opener

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

/**
 * The style attribute as a browser reads it: entities decoded, CSS comments gone.
 * A browser decodes `display&#58;none` before parsing the CSS and ignores `/**\/`
 * inside a declaration, so both hide the content.
 */
function isHidden(raw: string): boolean {
  const attrs = attributes(raw);
  if ("hidden" in attrs || attrs["aria-hidden"]?.trim().toLowerCase() === "true") return true;
  const style = decodeEntities(attrs.style ?? "").replace(CSS_COMMENT, "");
  return HIDDEN_STYLE.test(style) || (COLLAPSED_BOX.test(style) && CLIPPED.test(style));
}

/** Removed content: excerpts of hidden elements, and everything removed for scanning. */
interface Hidden { blocks: string[]; parts: string[] }

/**
 * Walk the tags with a name stack and HTML5 implied end tags, so a stray closer
 * cannot end a hidden element early and an unclosed <li> or <p> inside one cannot
 * swallow the rest of the page; a `/>` on a non-void tag is ignored, as browsers do.
 */
class Walker {
  visible: string[] = [];
  private buffer: string[] = [];
  private stack: string[] = [];
  private nav = new Set<number>();
  private hiddenAt: number | null = null;
  constructor(private hidden: Hidden) {}

  emit(text: string): void { (this.hiddenAt === null ? this.visible : this.buffer).push(text); }

  flush(): void {
    const block = fold(decodeEntities(this.buffer.join("")));
    this.buffer = [];
    this.hiddenAt = null;
    // The excerpt carries no invisible characters; the raw block goes to the
    // scanned hidden text. Clean before cutting, or a run of invisible
    // characters at the front would leave an empty excerpt.
    if (block) { this.hidden.blocks.push(cut(cleanText(block).text, EXCERPT)); this.hidden.parts.push(block); }
  }

  private popTo(index: number): void {
    this.stack.length = index;
    this.nav = new Set([...this.nav].filter(i => i < index));
    if (this.hiddenAt !== null && this.hiddenAt >= this.stack.length) this.flush();
  }

  tag(closing: boolean, name: string, raw: string): void {
    if (BLOCK.has(name)) this.emit("\n");
    if (closing) {
      const index = this.stack.lastIndexOf(name);
      if (index >= 0) this.popTo(index);
      return; // a closer with no matching opener is ignored
    }
    const isNav = this.nav.size > 0 || name === "nav" || attributes(raw).role?.trim().toLowerCase() === "navigation";
    const hiddenHere = isHidden(raw);
    if ((this.hiddenAt !== null || hiddenHere) && !isNav) this.hidden.parts.push(...(decodeEntities(raw).match(URL_PATTERN) ?? []));
    if (VOID.has(name)) return;
    const top = this.stack.at(-1);
    if ((IMPLIED_END.has(name) && top === name) || (CLOSES_P.has(name) && top === "p")) this.popTo(this.stack.length - 1);
    this.stack.push(name);
    const index = this.stack.length - 1;
    if (isNav) this.nav.add(index);
    if (this.hiddenAt === null && hiddenHere) this.hiddenAt = index;
  }

  finish(): void { if (this.hiddenAt !== null) this.flush(); }
}

/**
 * Visible text and the hidden content that was removed. Unterminated comments
 * and script/style blocks hide to the end of input, as browsers do.
 */
export function cleanHtml(markup: string): { text: string; hiddenBlocks: string[]; hiddenText: string } {
  const hidden: Hidden = { blocks: [], parts: [] };
  const collect = (match: string) => {
    hidden.parts.push(decodeEntities(match.replace(/<!--|-->/g, " ").replace(/<[^>]+>/g, " ")));
    return " ";
  };
  const source = markup.replace(PRESTRIP, " ").replace(COMMENT, collect).replace(DROP_BLOCKS, collect);
  const walker = new Walker(hidden);
  let pos = 0;
  for (const m of source.matchAll(TAG)) {
    walker.emit(source.slice(pos, m.index));
    pos = m.index + m[0].length;
    walker.tag(m[1] === "/", m[2]!.toLowerCase(), m[3]!);
  }
  walker.emit(source.slice(pos));
  walker.finish();
  return { text: fold(decodeEntities(walker.visible.join(""))), hiddenBlocks: hidden.blocks, hiddenText: hidden.parts.join("\n") };
}
