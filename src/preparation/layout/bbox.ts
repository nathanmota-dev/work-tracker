import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../command.ts";
import { LIST_MARKERS, makePage, type Line, type Page } from "./geometry.ts";

/** The extractor cannot measure this PDF; the layout check is skipped, never failed. */
export class LayoutUnavailable extends Error {}

export interface Word { xMin: number; yMin: number; yMax: number; text: string }

const PAGE_RE = /<page width="[\d.]+" height="([\d.]+)">([\s\S]*?)<\/page>/g;
const WORD_RE = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] !== "#") return ENTITIES[name] ?? match;
    const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** xMin of the first word after leading LIST_MARKERS words, if there were any. */
export function textStart(words: Word[]): number | undefined {
  let lead = 0;
  while (lead < words.length && words[lead]!.text && [...words[lead]!.text].every(char => LIST_MARKERS.has(char))) lead++;
  return lead > 0 && lead < words.length ? words[lead]!.xMin : undefined;
}

function lineOf(words: Word[]): Line {
  const sorted = [...words].sort((a, b) => a.xMin - b.xMin || a.yMin - b.yMin);
  return {
    top: Math.min(...sorted.map(word => word.yMin)),
    bottom: Math.max(...sorted.map(word => word.yMax)),
    left: sorted[0]!.xMin,
    height: Math.max(...sorted.map(word => word.yMax - word.yMin)),
    text: sorted.map(word => word.text).join(" "),
    textLeft: textStart(sorted),
  };
}

/** Parse `pdftotext -bbox` output; words sharing a rounded top form one line. */
export function parseBbox(xml: string): Page[] {
  return [...xml.matchAll(PAGE_RE)].map(([, height, content]) => {
    const buckets = new Map<number, Word[]>();
    for (const [, xMin, yMin, yMax, text] of content!.matchAll(WORD_RE)) {
      const word = { xMin: Number(xMin), yMin: Number(yMin), yMax: Number(yMax), text: decode(text!) };
      const key = Math.round(word.yMin);
      buckets.set(key, [...buckets.get(key) ?? [], word]);
    }
    return makePage(Number(height), [...buckets.values()].map(lineOf));
  });
}

function unavailable(error: unknown): LayoutUnavailable {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Could not run")) return new LayoutUnavailable("pdftotext (Poppler) is not installed or not on PATH");
  const [head, ...rest] = message.split("\n");
  const detail = (rest.map(line => line.trim()).find(Boolean) ?? head!).slice(0, 160);
  return new LayoutUnavailable(`pdftotext could not produce word bounding boxes (${detail}). It needs a Poppler build with -bbox; Poppler 26.01 to 26.04 also aborts on a PDF whose metadata has empty fields, which hyperref writes unless pdftitle is set`);
}

/** Word geometry of every page. Throws LayoutUnavailable when the extractor cannot measure the PDF. */
export async function readBbox(path: string, signal?: AbortSignal): Promise<Page[]> {
  const dir = mkdtempSync(join(tmpdir(), "work-tracker-bbox-"));
  try {
    const output = join(dir, "bbox.html");
    let xml: string;
    try {
      // Written to a file: the command output also carries stderr and is bounded.
      await runCommand("pdftotext", ["-bbox", "-enc", "UTF-8", path, output], undefined, signal, 30000);
      xml = readFileSync(output, "utf8");
    } catch (error) {
      signal?.throwIfAborted();
      throw unavailable(error);
    }
    const pages = parseBbox(xml);
    if (!pages.length) throw new LayoutUnavailable("pdftotext produced no word bounding boxes");
    return pages;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
