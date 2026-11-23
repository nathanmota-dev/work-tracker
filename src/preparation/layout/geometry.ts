/**
 * Page geometry from Poppler word bounding boxes, in PDF points with the origin at
 * the top left. Thresholds are calibrated for common one-column resume templates
 * (moderncv and article-based); a template with unusual margins may need them retuned.
 */

/** A gap larger than this between consecutive lines is a hole, not spacing. Section
 * spacing runs to roughly 45 pt; 100 pt is about seven lines. */
export const GAP_LIMIT_PT = 100;
/** Bottom whitespace, as a share of the page, on a page that is not the last one. */
export const BOTTOM_LIMIT_FRACTION = 0.25;
/** A final page emptier than this reads as an unfinished document. */
export const LAST_PAGE_THIN_FRACTION = 0.35;
/** The page-number footer lives in this bottom band and is ignored when measuring the body. */
export const FOOTER_BAND_PT = 90;
/** A line whose text starts this far past the document margin is a bullet or a continuation. */
export const INDENT_PT = 8;
/** Glyphs that label a list item when a template merges them into the item's first line.
 * Unicode only: ASCII `-`, `*` and the dashes also open real text. */
export const LIST_MARKERS = new Set(["\u2022", "\u2023", "\u25aa", "\u25cf", "\u00b7"]);
/** Lines whose tops are this close are parts of one printed line: Poppler splits a printed
 * line when a word in another font sits a fraction of a point off. Lines are ~12 pt apart. */
export const SAME_PRINTED_LINE_PT = 3;
/** A line whose text starts further in than this is set right or centred (a running header),
 * not where a page's body resumes. Lists set text in by 11-25 pt. */
export const SET_IN_LIMIT_PT = 60;
/** A line this much taller than the body median is a section heading. */
export const HEADING_HEIGHT_RATIO = 1.25;
/** Roughly one body line, to express a hole in blank lines. */
export const LINE_PITCH_PT = 14;

export interface Line {
  top: number; bottom: number; left: number; height: number; text: string;
  /** Where the text starts once leading LIST_MARKERS words are set aside. */
  textLeft?: number;
}
export interface Page { height: number; lines: Line[] }

export function makePage(height: number, lines: Line[]): Page {
  return { height, lines: [...lines].sort((a, b) => a.top - b.top) };
}
export const textX = (line: Line): number => line.textLeft ?? line.left;
export const hasText = (line: Line): boolean => /[\p{L}\p{N}_]/u.test(line.text);
const tenth = (value: number) => Math.round(value * 10) / 10;

/** A lone page number ("2", "2/3", "Page 2 of 3"). */
const PAGE_NUMBER = /^(?:page\s+)?\d{1,3}(?:\s*(?:\/|of)\s*\d{1,3})?$/i;
/** The lower share of the page where a page number set above the footer band may sit. */
const PAGE_NUMBER_ZONE = 0.75;

/**
 * Lines above the footer band. A page number that a template sets just above the band
 * (the article class does) is dropped too, or the space above it would read as a hole.
 */
export function body(page: Page): Line[] {
  const cutoff = page.height - FOOTER_BAND_PT;
  const lines = page.lines.filter(line => line.top < cutoff);
  const last = lines.at(-1);
  return last && lines.length > 1 && last.top > page.height * PAGE_NUMBER_ZONE && PAGE_NUMBER.test(last.text.trim()) ? lines.slice(0, -1) : lines;
}
export function bottomSpace(page: Page): number {
  const lines = body(page);
  return lines.length ? page.height - Math.max(...lines.map(line => line.bottom)) : page.height;
}
export function isHeading(page: Page, line: Line): boolean {
  const heights = body(page).map(item => item.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  return median > 0 && line.height > median * HEADING_HEIGHT_RATIO;
}
/** One line in the bottom band is a page number; two mean body text spilled into it. */
export function footerCrowded(page: Page): boolean {
  const band = page.height - FOOTER_BAND_PT;
  return new Set(page.lines.filter(line => line.top >= band).map(line => tenth(line.top))).size > 1;
}
/**
 * Largest top-to-top distance between body lines, and where it starts. Measuring top
 * to top lets a tall line inflate the gap by its own height, which errs toward reporting.
 */
export function largestGap(page: Page): { gap: number; at: number } {
  const tops = [...new Set(body(page).map(line => tenth(line.top)))].sort((a, b) => a - b);
  let largest = { gap: 0, at: 0 };
  for (let i = 0; i + 1 < tops.length; i++) {
    const gap = tops[i + 1]! - tops[i]!;
    if (gap > largest.gap) largest = { gap, at: tops[i]! };
  }
  return largest;
}
