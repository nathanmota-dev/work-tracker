import type { BboxPage } from "./bbox.ts";
import { isFooter } from "./columns.ts";
import { SIDEBAR_SECTIONS, sectionTitle } from "./sections.ts";

/** A LinkedIn export has a sidebar title on its first page and a `Page N of M` footer. */
export function isLinkedInExport(pages: BboxPage[]): boolean {
  const first = pages[0]?.lines ?? [];
  return first.some(line => SIDEBAR_SECTIONS.includes(sectionTitle(line.text)!)) && pages.some(page => page.lines.some(line => isFooter(line.text)));
}
