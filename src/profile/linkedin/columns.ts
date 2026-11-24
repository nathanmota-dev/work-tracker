import type { BboxLine, BboxPage } from "./bbox.ts";
import { SIDEBAR_SECTIONS, sectionTitle } from "./sections.ts";

const FOOTER = /^(?:Page|Página)\s+\d+\s+(?:of|de)\s+\d+$/i;
export const isFooter = (text: string) => FOOTER.test(text.trim());
const isSidebarTitle = (line: BboxLine) => SIDEBAR_SECTIONS.includes(sectionTitle(line.text)!);
const byPosition = (a: BboxLine, b: BboxLine) => a.yMin - b.yMin || a.xMin - b.xMin;

/**
 * The x where the main column starts: the widest horizontal gap that no line
 * crosses. No fixed threshold in points, so any page size and margin works.
 */
export function columnSplit(lines: BboxLine[]): number | null {
  const starts = [...new Set(lines.map(line => line.xMin))].sort((a, b) => a - b);
  let best: { x: number; gap: number } | null = null;
  for (const x of starts.slice(1)) {
    const leftEnd = Math.max(...lines.filter(line => line.xMin < x).map(line => line.xMax));
    const gap = x - leftEnd;
    if (gap > 0 && (!best || gap > best.gap)) best = { x, gap };
  }
  return best?.x ?? null;
}

/**
 * Reading order of an export: the sidebar of the page that has one, then the
 * main column, then the other pages in sequence. Page footers are removed, so
 * an entry cut by a page break continues on the next page.
 */
export function readingOrder(pages: BboxPage[]): { sidebar: string[]; main: string[] } {
  const sidebar: string[] = [];
  const main: string[] = [];
  for (const page of pages) {
    const lines = page.lines.filter(line => !isFooter(line.text)).sort(byPosition);
    const split = lines.some(isSidebarTitle) ? columnSplit(lines) : null;
    const left = split === null ? [] : lines.filter(line => line.xMin < split);
    if (!left.some(isSidebarTitle)) { main.push(...lines.map(line => line.text)); continue; }
    sidebar.push(...left.map(line => line.text));
    main.push(...lines.filter(line => line.xMin >= split!).map(line => line.text));
  }
  return { sidebar, main };
}
