import { runCommand } from "../../preparation/command.ts";

/** One text line of a PDF page with its horizontal extent, in points. */
export interface BboxLine { text: string; xMin: number; yMin: number; xMax: number }
export interface BboxPage { page: number; width: number; lines: BboxLine[] }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Decode the XML entities pdftotext writes; unknown named entities stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return ENTITIES[entity.toLowerCase()] ?? match;
    const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}
const attribute = (tag: string, name: string) => Number(new RegExp(`\\b${name}="([\\d.]+)"`).exec(tag)?.[1] ?? 0);

/** Convert `pdftotext -bbox-layout` XHTML into pages of lines. Regex only: no XML dependency. */
export function parseBbox(xhtml: string): BboxPage[] {
  const pages: BboxPage[] = [];
  for (const page of xhtml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
    const lines: BboxLine[] = [];
    for (const line of page[2]!.matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g)) {
      const words = [...line[2]!.matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/g)].map(word => decodeEntities(word[1]!).trim()).filter(Boolean);
      if (words.length) lines.push({ text: words.join(" "), xMin: attribute(line[1]!, "xMin"), yMin: attribute(line[1]!, "yMin"), xMax: attribute(line[1]!, "xMax") });
    }
    pages.push({ page: pages.length + 1, width: attribute(page[1]!, "width"), lines });
  }
  return pages;
}

/** Text lines of every page of a PDF, with coordinates. */
export async function readBbox(path: string, signal?: AbortSignal): Promise<BboxPage[]> {
  return parseBbox(await runCommand("pdftotext", ["-q", "-bbox-layout", path, "-"], undefined, signal, 30000));
}
