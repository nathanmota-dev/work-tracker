import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { runCommand } from "../command.ts";
import { LayoutUnavailable, parseBbox, readBbox, textStart } from "./bbox.ts";

vi.mock("../command.ts", () => ({ runCommand: vi.fn() }));
const word = (x: number, y: number, text: string, h = 10) => `<word xMin="${x}" yMin="${y}" xMax="${x + 30}" yMax="${y + h}">${text}</word>`;
const doc = (...pages: string[]) => `<!DOCTYPE html><html><body><doc>${pages.map(words => `<page width="612.000000" height="792.000000">${words}</page>`).join("")}</doc></body></html>`;

beforeEach(() => {
  vi.spyOn(fs, "mkdtempSync").mockReturnValue("/tmp/bbox");
  vi.mocked(fs.rmSync).mockReturnValue(undefined);
  vi.mocked(fs.readFileSync).mockReturnValue(doc(word(50, 60, "Hello")));
  vi.mocked(runCommand).mockReset().mockResolvedValue("");
});

test("groups words by rounded top, joins them left to right and decodes entities", () => {
  const [page] = parseBbox(doc(word(90, 60.4, "&amp; Co") + word(50, 59.8, "Smith", 12) + word(50, 80, "&lt;b&gt; &#x41;&#66; &quot;x&quot; &apos; &nope; &#1114112;")));
  expect(page!.height).toBe(792);
  expect(page!.lines).toEqual([
    { top: 59.8, bottom: 71.8, left: 50, height: 12, text: "Smith & Co", textLeft: undefined },
    { top: 80, bottom: 90, left: 50, height: 10, text: "<b> AB \"x\" ' &nope; &#1114112;", textLeft: undefined },
  ]);
});

test("reads every page and records where the text starts after a list marker", () => {
  const pages = parseBbox(doc(word(50, 60, "\u2022") + word(64, 60, "Built"), word(50, 60, "Next")));
  expect(pages).toHaveLength(2);
  expect(pages[0]!.lines[0]).toMatchObject({ left: 50, textLeft: 64, text: "\u2022 Built" });
  expect(parseBbox("<doc></doc>")).toEqual([]);
});

const startCases: [[string, number][], number | undefined][] = [
  [[["\u2022", 58.9], ["Laid", 72.1]], 72.1],
  [[["Kitchen", 59.5], ["Gardener", 94.9]], undefined],
  [[["\u2022", 59]], undefined],
  ...["-", "*", "\u2013", "\u2014", "\u25cb"].map((glyph): [[string, number][], undefined] => [[[glyph, 69.4], ["[Event]", 77.7]], undefined]),
];
test.each(startCases)("textStart sets aside only leading list markers (%j)", (words, expected) => {
  expect(textStart(words.map(([text, xMin]) => ({ text, xMin, yMin: 0, yMax: 1 })))).toBe(expected);
});

test("runs pdftotext -bbox into a temporary file and removes it", async () => {
  const signal = new AbortController().signal;
  const pages = await readBbox("/a b.pdf", signal);
  expect(pages[0]!.lines[0]!.text).toBe("Hello");
  expect(runCommand).toHaveBeenCalledWith("pdftotext", ["-bbox", "-enc", "UTF-8", "/a b.pdf", "/tmp/bbox/bbox.html"], undefined, signal, 30000);
  expect(fs.readFileSync).toHaveBeenCalledWith("/tmp/bbox/bbox.html", "utf8");
  expect(fs.rmSync).toHaveBeenCalledWith("/tmp/bbox", { recursive: true, force: true });
});

test.each([
  ["Could not run pdftotext: ENOENT. Install it and make it available on PATH.", "not installed or not on PATH"],
  ["pdftotext failed (99):\nUnknown option -bbox\nusage", "(Unknown option -bbox)"],
  ["pdftotext failed (134):\n\nterminate called after throwing an instance", "(terminate called after throwing an instance). It needs a Poppler build with -bbox; Poppler 26.01 to 26.04"],
  ["pdftotext timed out.", "(pdftotext timed out.)"],
])("reports an unusable extractor as skippable (%s)", async (message, reason) => {
  vi.mocked(runCommand).mockRejectedValue(new Error(message));
  const error = await readBbox("/r.pdf").catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(LayoutUnavailable);
  expect((error as Error).message).toContain(reason);
  expect(fs.rmSync).toHaveBeenCalled();
});

test("output without pages or an unreadable output file is skippable", async () => {
  vi.mocked(fs.readFileSync).mockReturnValueOnce("<html></html>");
  await expect(readBbox("/r.pdf")).rejects.toThrow("no word bounding boxes");
  vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw "missing"; });
  await expect(readBbox("/r.pdf")).rejects.toBeInstanceOf(LayoutUnavailable);
});

test("cancellation is not a skipped check", async () => {
  const controller = new AbortController();
  vi.mocked(runCommand).mockImplementation(async () => { controller.abort(); throw new Error("Cancelled"); });
  const error = await readBbox("/r.pdf", controller.signal).catch((caught: unknown) => caught);
  expect(error).not.toBeInstanceOf(LayoutUnavailable);
  expect(fs.rmSync).toHaveBeenCalled();
});
