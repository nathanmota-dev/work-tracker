import { describe, expect, test } from "vitest";
import { parseBbox } from "./bbox.ts";
import { findFooterCollision, findHoles, findOrphans, findShortPages, layoutFindings } from "./findings.ts";
import { body, bottomSpace, footerCrowded, isHeading, largestGap, makePage, type Line } from "./geometry.ts";

const A4 = 842;
const line = (top: number, left = 50, height = 10, text = "x"): Line => ({ top, bottom: top + height, left, height, text });
/** A bbox line; textLeft is where its text starts after a merged list marker. */
const at = (top: number, left: number, text: string, textLeft?: number, bottom = top + 14): Line => ({ top, bottom, left, height: bottom - top, text, textLeft });
const page = (...lines: Line[]) => makePage(A4, lines);
const messages = (findings: { message: string }[]) => findings.map(finding => finding.message);

/** Small `pdftotext -bbox` documents: each page is a list of [x, y, text, height?]. */
type Word = [number, number, string, number?];
const xml = (...pages: Word[][]) => `<doc>${pages.map(words => `<page width="595.276000" height="${A4}.000000">${words.map(([x, y, text, h = 10]) => `<word xMin="${x}" yMin="${y}" xMax="${x + 40}" yMax="${y + h}">${text}</word>`).join("")}</page>`).join("")}</doc>`;
const filled = (from: number, to: number, x = 50): Word[] => Array.from({ length: Math.floor((to - from) / 14) + 1 }, (_, i) => [x, from + i * 14, `line${i}`]);

describe("gap and bottom space", () => {
  const holed = page(line(50), line(64), line(78), line(400), line(770, 50, 10, "1/2"));
  test("reports the hole an ejected entry leaves behind with its size and position", () => {
    expect(largestGap(holed)).toEqual({ gap: 322, at: 78 });
    expect(messages(findHoles([holed]))).toEqual(["Page 1 has a 322 pt gap at y=78 (about 23 blank lines). An entry that did not fit may have moved to the next page."]);
  });
  test("measures the bottom to the last body line, not the page number", () => {
    expect(Math.round(bottomSpace(holed))).toBe(432);
    expect(bottomSpace(page())).toBe(A4);
    expect(body(page())).toEqual([]);
  });
  test("ignores a lone page number set just above the footer band", () => {
    const article = page(line(100), line(114), line(735, 290, 10, "2"));
    expect(body(article)).toHaveLength(2);
    expect(findHoles([article])).toEqual([]);
    expect(body(page(line(100), line(735, 290, 10, "Experience")))).toHaveLength(2);
    expect(body(page(line(735, 290, 10, "2")))).toHaveLength(1);
  });
});

describe("footer band", () => {
  test("one line in the band is the page number; two mean body text spilled in", () => {
    expect(footerCrowded(page(line(50), line(800, 50, 10, "2/2")))).toBe(false);
    expect(footerCrowded(page(line(50), line(780), line(800)))).toBe(true);
    expect(messages(findFooterCollision([page(line(50), line(780), line(800))]))).toEqual(["Page 1 has body text inside the page-number band at the bottom."]);
    expect(findFooterCollision([page(line(780), line(800))])).toEqual([]);
  });
});

describe("short pages", () => {
  test("flags a non-final page that ends early, a thin final page and an empty page", () => {
    const early = page(line(50), line(400));
    expect(messages(findShortPages([early, page(...Array.from({ length: 50 }, (_, i) => line(50 + i * 14)))]))).toEqual(["Page 1 ends 432 pt (51%) before the bottom although more pages follow."]);
    expect(messages(findShortPages([page(...Array.from({ length: 50 }, (_, i) => line(50 + i * 14))), early]))).toEqual(["The last page (page 2) is 51% empty."]);
    expect(messages(findShortPages([page(), page(line(50))]))).toEqual(["Page 1 has no text.", "The last page (page 2) is 93% empty."]);
    expect(findShortPages([early])).toEqual([]);
  });
});

describe("heading detection", () => {
  test("a taller line is a heading", () => {
    const p = page(line(50, 50, 16, "Professional Experience"), line(80), line(94, 70));
    expect(isHeading(p, p.lines[0]!)).toBe(true);
    expect(isHeading(p, p.lines[1]!)).toBe(false);
    expect(isHeading(page(), line(50))).toBe(false);
  });
});

describe("orphans", () => {
  test("a page ending on a section heading", () => {
    const found = findOrphans([page(line(50), line(64), line(700, 50, 16, "Education")), page(line(60, 50, 10, "Example University"), line(74, 70))]);
    expect(messages(found)).toEqual(["Page 1 ends on the section heading \u201cEducation\u201d; its content continues on page 2."]);
  });
  test("an entry header orphaned from its bullets", () => {
    const found = findOrphans([page(line(50), line(700, 50, 10, "Software Engineer")), page(line(60, 70, 10, "- built the thing"))]);
    expect(messages(found)).toEqual(["Page 1 ends on an entry header (\u201cSoftware Engineer\u201d) whose content continues on page 2."]);
  });
  test("a lone list marker is a split bullet, not an orphaned header", () => {
    expect(messages(findOrphans([page(line(50), line(700, 50, 10, "\u25cf")), page(line(60, 70, 10, "continued item text here"))]))).toEqual(["Page 1 ends on a lone list marker; its bullet continues on page 2."]);
  });
  test("a clean break, an empty page or a single page reports nothing", () => {
    expect(findOrphans([page(line(50), line(700)), page(line(60))])).toEqual([]);
    expect(findOrphans([page(line(50)), page()])).toEqual([]);
    expect(findOrphans([page()])).toEqual([]);
  });
  test("indent is judged against the document margin", () => {
    expect(findOrphans([page(line(50), line(700, 50, 10, "Data Analyst")), page(line(60, 70, 10, "- first bullet"))])).toHaveLength(1);
  });
});

describe("orphans read where the text starts", () => {
  test.each([
    ["a bullet wrapping across the break", [at(50, 59.5, "Plant Grower 1981-1990"), at(700, 58.9, "\u2022 Replanted the long border", 72.1)], [at(60, 72.1, "from seed, lifting the old clumps")]],
    ["a continuation opening with a dash", [at(700, 58.9, "\u2022 Laid a new cobbled path, so", 72.1)], [at(60, 72.1, "\u2014 that rain ran off into the borders")]],
    ["an outer marker set below a whole item", [at(50, 59.5, "Core Competencies", undefined, 70.5), at(728.81, 70.4, "[Skill Category 4]: [Domain]", undefined, 743.4), at(730.09, 59, "\u{1f7e4}", undefined, 741.8)], [at(66.8, 70.4, "[Skill Category 5]: [Tools]", undefined, 81.4), at(68.1, 59, "\u{1f7e4}", undefined, 79.8)]],
    ["a two-line item wrapping across the break", [at(696.4, 59.5, "Honors and Awards", undefined, 716.9), at(722.13, 70.4, "[Award Name] for the orchard", undefined, 736.7), at(723.41, 59, "\u{1f7e4}", undefined, 735.09)], [at(66.8, 69.4, "\u2013 [Event/Organization] ([Year]).")]],
    ["a printed line split by font", [at(721.44, 125.6, "operations for the data team."), at(721.64, 70.4, "Kubernetes Terraform")], [at(66.8, 70.4, "[Skill Category 3]: [Specific skills]")]],
    ["a stock bullet wrapping across the break", [at(700, 81.3, "[Achievement 1 - be")], [at(60, 81.3, "specific, use numbers]")]],
    ["a running header on the next page", [at(50, 59.5, "Professional Experience"), at(700, 81.3, "[Achievement 2]")], [at(27, 459.8, "[First] [Last] \u2013 CV"), at(62, 70.4, "[Company] [City, Country]")]],
  ])("%s is not an orphan", (_name, first, second) => {
    expect(findOrphans([page(...first), page(...second)])).toEqual([]);
  });
  test.each([
    ["a header level with merged bullets", [at(700, 59.5, "Kitchen Gardener 1975-1980")], [at(60, 58.9, "\u2022 Worked in the kitchen garden", 71.6)]],
    ["a header whose outer marker is its own line", [at(323, 59.5, "Professional Experience"), at(695.9, 59, "\u25cb", undefined, 707.6), at(700.5, 70.4, "[Job Title] [YYYY-YYYY]")], [at(62.4, 71.5, "-", undefined, 79.5), at(64.4, 81.3, "[Achievement 1]")]],
    ["a header with its outer marker merged in", [at(700, 59, "\u25cb [Job Title] [YYYY-YYYY]")], [at(62.4, 71.5, "-", undefined, 79.5), at(64.4, 81.3, "[Achievement 1]")]],
    ["a degree and its description", [at(700, 59, "\u25cb [Degree] in [Field] [YYYY-YYYY]")], [at(60, 70.4, "[Brief description or key topics.]")]],
    ["an orphan behind a running header", [at(50, 59.5, "Professional Experience"), at(700, 70.4, "[Job Title]")], [at(27, 459.8, "[First] [Last] \u2013 CV"), at(62.4, 71.5, "-", undefined, 79.5), at(64.4, 81.3, "[Achievement 1]")]],
  ])("%s is an orphan", (_name, first, second) => {
    expect(findOrphans([page(...first), page(...second)])[0]?.code).toMatch(/^orphan-entry:1:/);
  });
  test("a next page with only set-in text has no opener", () => {
    expect(findOrphans([page(at(700, 59.5, "[Job Title]")), page(at(60, 300, "Right aligned"))])).toEqual([]);
  });
});

describe("bbox fixtures", () => {
  const twoPages = (last: Word[], next: Word[]) => parseBbox(xml([...filled(60, 690), ...last], [...next, ...filled(100, 700)]));
  test("a clean document reports nothing", () => {
    expect(layoutFindings(twoPages([[50, 704, "Last line of page one."]], [[50, 60, "Next entry header"]]))).toEqual([]);
  });
  test("an entry header at the bottom of page 1 with its bullets on page 2", () => {
    expect(messages(layoutFindings(twoPages([[50, 704, "Software Engineer"]], [[50, 60, "\u2022", 10], [70, 60, "Built the thing"]])))).toEqual(["Page 1 ends on an entry header (\u201cSoftware Engineer\u201d) whose content continues on page 2."]);
  });
  test("a section heading stranded at the bottom", () => {
    expect(messages(layoutFindings(twoPages([[50, 704, "Education", 16]], [[50, 60, "Example University"]])))).toEqual(["Page 1 ends on the section heading \u201cEducation\u201d; its content continues on page 2."]);
  });
  test("a hole, a page that ends early, a thin last page and a footer collision", () => {
    const pages = parseBbox(xml([[50, 60, "Top"], [50, 74, "Second"], [50, 400, "After hole"]], [[50, 60, "Only line"], [50, 780, "Spilled"], [290, 800, "2"]]));
    expect(layoutFindings(pages).map(finding => finding.code)).toEqual(["hole:1", "ends-early:1", "thin-last-page", "footer:2"]);
  });
});
