import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { runCommand } from "./command.ts";
import { LayoutUnavailable, readBbox } from "./layout/bbox.ts";
import { makePage, type Line } from "./layout/geometry.ts";
import { reviewPdf, reviewWarnings } from "./pdf-review.ts";

vi.mock("./command.ts", () => ({ runCommand: vi.fn() }));
vi.mock("./layout/bbox.ts", async original => ({ ...await original<typeof import("./layout/bbox.ts")>(), readBbox: vi.fn() }));
const line = (top: number, left: number, text: string): Line => ({ top, bottom: top + 10, left, height: 10, text });
const full = (...last: Line[]) => makePage(842, [...Array.from({ length: 45 }, (_, i) => line(60 + i * 14, 50, `line ${i}`)), ...last]);
/** Page 1 ends on an entry header whose bullets continue on page 2. */
const orphaned = [full(line(704, 50, "Software Engineer")), full(line(40, 70, "Built the thing"))];
const clean = [full(line(704, 50, "Last line")), full()];
const identity = { email: "ada@example.com" };

beforeEach(() => {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(runCommand).mockReset().mockResolvedValue("base text ada@example.com");
  vi.mocked(readBbox).mockReset().mockResolvedValue(clean);
});

test("reports layout findings before text-layer findings", async () => {
  vi.mocked(readBbox).mockResolvedValue(orphaned);
  expect(await reviewWarnings("/t.pdf", "Software Engineer", { identity })).toEqual([
    "Page 1 ends on an entry header (\u201cSoftware Engineer\u201d) whose content continues on page 2.",
    "The text layer does not contain your email (ada@example.com) as text.",
  ]);
  expect(readBbox).toHaveBeenCalledTimes(1);
});

test("a PDF identical to the base reports nothing new, even with findings", async () => {
  vi.mocked(readBbox).mockResolvedValue(orphaned);
  vi.mocked(runCommand).mockResolvedValue("Software Engineer");
  const signal = new AbortController().signal;
  expect(await reviewWarnings("/t.pdf", "Software Engineer", { identity, baseline: "/base.pdf" }, signal)).toEqual([]);
  expect(readBbox).toHaveBeenCalledWith("/base.pdf", signal);
  expect(runCommand).toHaveBeenCalledWith("pdftotext", ["-layout", "/base.pdf", "-"], undefined, signal);
});

test("reports only findings the base does not have", async () => {
  vi.mocked(readBbox).mockImplementation(async path => (path === "/base.pdf" ? clean : orphaned));
  expect(await reviewWarnings("/t.pdf", "Software Engineer ada@example.com", { identity, baseline: "/base.pdf" })).toEqual([
    "Page 1 ends on an entry header (\u201cSoftware Engineer\u201d) whose content continues on page 2.",
  ]);
});

test("a missing baseline file compares against nothing", async () => {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(readBbox).mockResolvedValue(orphaned);
  expect(await reviewWarnings("/t.pdf", "x", { baseline: "/gone.pdf" })).toHaveLength(1);
  expect(runCommand).not.toHaveBeenCalled();
});

test("an unusable extractor skips the layout check with one warning and keeps text findings", async () => {
  vi.mocked(readBbox).mockRejectedValue(new LayoutUnavailable("pdftotext has no -bbox"));
  expect(await reviewWarnings("/t.pdf", "\uf0e0", { baseline: "/base.pdf" })).toEqual([
    expect.stringContaining("private-use"),
    "Layout check skipped: pdftotext has no -bbox.",
  ]);
  expect(await reviewPdf("/t.pdf", "x")).toEqual({ text: [], skipped: "pdftotext has no -bbox" });
});

test("a base the extractor cannot measure skips the layout comparison", async () => {
  vi.mocked(readBbox).mockImplementation(async path => { if (path === "/base.pdf") throw new LayoutUnavailable("Poppler aborted"); return orphaned; });
  expect(await reviewWarnings("/t.pdf", "x", { baseline: "/base.pdf" })).toEqual(["Layout check skipped: Poppler aborted."]);
});

test("an unreadable base skips the comparison instead of failing generation", async () => {
  vi.mocked(runCommand).mockRejectedValue(new Error("pdftotext failed (1):\nbroken"));
  expect(await reviewWarnings("/t.pdf", "x", { baseline: "/base.pdf" })).toEqual(["Layout check skipped: the base PDF could not be read (pdftotext failed (1):)."]);
  vi.mocked(runCommand).mockRejectedValue("odd");
  expect(await reviewWarnings("/t.pdf", "x", { baseline: "/base.pdf" })).toEqual(["Layout check skipped: the base PDF could not be read (odd)."]);
});

test("cancellation and unexpected errors propagate", async () => {
  vi.mocked(readBbox).mockRejectedValue(new Error("Cancelled"));
  await expect(reviewWarnings("/t.pdf", "x", {})).rejects.toThrow("Cancelled");
  vi.mocked(readBbox).mockResolvedValue(clean);
  const controller = new AbortController();
  vi.mocked(runCommand).mockImplementation(async () => { controller.abort(); throw new Error("Cancelled"); });
  await expect(reviewWarnings("/t.pdf", "x", { baseline: "/base.pdf" }, controller.signal)).rejects.toThrow();
});
