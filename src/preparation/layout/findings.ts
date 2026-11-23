import {
  BOTTOM_LIMIT_FRACTION, GAP_LIMIT_PT, INDENT_PT, LAST_PAGE_THIN_FRACTION, LINE_PITCH_PT, SAME_PRINTED_LINE_PT, SET_IN_LIMIT_PT,
  body, bottomSpace, footerCrowded, hasText, isHeading, largestGap, textX, type Line, type Page,
} from "./geometry.ts";

/** `code` identifies the finding across two PDFs, so one the base already has is not reported again. */
export interface Finding { code: string; message: string }

const quote = (text: string) => `\u201c${text.trim().replace(/\s+/g, " ").slice(0, 60)}\u201d`;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const pages = (all: Page[]) => all.map((page, index) => ({ page, number: index + 1, lines: body(page) }));

/** A gap between consecutive lines larger than an entry's normal spacing. */
export function findHoles(all: Page[]): Finding[] {
  return pages(all).flatMap(({ page, number, lines }) => {
    const { gap, at } = largestGap(page);
    if (!lines.length || gap <= GAP_LIMIT_PT) return [];
    return [{ code: `hole:${number}`, message: `Page ${number} has a ${Math.round(gap)} pt gap at y=${Math.round(at)} (about ${Math.round(gap / LINE_PITCH_PT)} blank lines). An entry that did not fit may have moved to the next page.` }];
  });
}

/** Empty pages, a non-final page that stops early and a mostly empty final page. */
export function findShortPages(all: Page[]): Finding[] {
  return pages(all).flatMap(({ page, number, lines }) => {
    if (!lines.length) return [{ code: `empty:${number}`, message: `Page ${number} has no text.` }];
    const space = bottomSpace(page);
    const share = space / page.height;
    if (number < all.length && share > BOTTOM_LIMIT_FRACTION)
      return [{ code: `ends-early:${number}`, message: `Page ${number} ends ${Math.round(space)} pt (${percent(share)}) before the bottom although more pages follow.` }];
    if (number === all.length && all.length > 1 && share > LAST_PAGE_THIN_FRACTION)
      return [{ code: "thin-last-page", message: `The last page (page ${number}) is ${percent(share)} empty.` }];
    return [];
  });
}

/** Body text pushed into the page-number band. */
export function findFooterCollision(all: Page[]): Finding[] {
  return pages(all).filter(({ page, lines }) => lines.length && footerCrowded(page))
    .map(({ number }) => ({ code: `footer:${number}`, message: `Page ${number} has body text inside the page-number band at the bottom.` }));
}

/** Where the text of one printed line starts, from the bbox lines that make it up. */
function printedTextX(lines: Line[]): number | undefined {
  const xs = lines.filter(hasText).map(textX);
  return xs.length ? Math.min(...xs) : undefined;
}

/**
 * A page ending on a section heading or an entry header whose content resumes overleaf.
 * Compares where the TEXT starts (after a merged list marker), not the line's left
 * edge, and judges indentation against the whole document's left margin, so a page
 * that opens with indented bullets does not mistake their indent for its margin.
 */
export function findOrphans(all: Page[]): Finding[] {
  const bodies = all.map(body);
  const lines = bodies.flat();
  if (!lines.length) return [];
  const margin = Math.min(...lines.map(line => line.left));
  const indented = (line: Line) => line.left > margin + INDENT_PT;
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < all.length; i++) {
    const here = bodies[i]!, next = bodies[i + 1]!;
    if (!here.length || !next.length) continue;
    const last = here.at(-1)!, first = next[0]!;
    const [page, following] = [i + 1, i + 2];
    if (isHeading(all[i]!, last)) {
      findings.push({ code: `orphan-heading:${page}:${last.text.trim()}`, message: `Page ${page} ends on the section heading ${quote(last.text)}; its content continues on page ${following}.` });
      continue;
    }
    const tail = here.filter(line => line.top >= last.top - SAME_PRINTED_LINE_PT);
    const lastX = printedTextX(tail);
    if (lastX === undefined) {
      // A list marker extracted as its own line: the bullet itself is split.
      if (!indented(last) && indented(first)) findings.push({ code: `split-bullet:${page}`, message: `Page ${page} ends on a lone list marker; its bullet continues on page ${following}.` });
      continue;
    }
    const opener = next.find(line => hasText(line) && textX(line) <= margin + SET_IN_LIMIT_PT);
    if (!opener) continue;
    const nextX = printedTextX(next.filter(line => Math.abs(line.top - opener.top) <= SAME_PRINTED_LINE_PT));
    if (nextX === undefined || nextX <= lastX + INDENT_PT) continue;
    const shown = tail.filter(hasText).reduce((a, b) => (b.text.length > a.text.length ? b : a));
    findings.push({ code: `orphan-entry:${page}:${shown.text.trim()}`, message: `Page ${page} ends on an entry header (${quote(shown.text)}) whose content continues on page ${following}.` });
  }
  return findings;
}

/** Every layout finding, orphans first. The page count is checked elsewhere. */
export function layoutFindings(all: Page[]): Finding[] {
  return [...findOrphans(all), ...findHoles(all), ...findShortPages(all), ...findFooterCollision(all)];
}
