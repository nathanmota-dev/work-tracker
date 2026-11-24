import { expect, test, vi } from "vitest";
import { runCommand } from "../../preparation/command.ts";
import { decodeEntities, parseBbox, readBbox } from "./bbox.ts";
import { columnSplit, readingOrder } from "./columns.ts";
import { durationMonths, exportDate, monthIndex, parsePeriod } from "./dates.ts";
import { joinBullets, looksLikeLocation, parseEducation, parseExperience } from "./experience.ts";
import { sectionTitle, splitSections } from "./sections.ts";

vi.mock("../../preparation/command.ts", () => ({ runCommand: vi.fn() }));

test("reads pdftotext -bbox-layout lines with their coordinates and decoded entities", async () => {
  const xhtml = '<page width="612.5" height="792"><line xMin="10.5" yMin="20" xMax="99" yMax="30"><word>R&amp;D</word> <word>&lt;lead&gt;</word></line><line xMin="1" yMin="2" xMax="3"><word> </word></line></page><page><line><word>&#233;&#x41;&#0;&unknown;</word></line></page>';
  expect(parseBbox(xhtml)).toEqual([
    { page: 1, width: 612.5, lines: [{ text: "R&D <lead>", xMin: 10.5, yMin: 20, xMax: 99 }] },
    { page: 2, width: 0, lines: [{ text: "éA&unknown;", xMin: 0, yMin: 0, xMax: 0 }] },
  ]);
  expect(decodeEntities("&quot;&apos;&nbsp;&AMP;")).toBe(`"' &`);
  vi.mocked(runCommand).mockResolvedValue(xhtml);
  const signal = new AbortController().signal;
  expect(await readBbox("/profile/a.pdf", signal)).toHaveLength(2);
  expect(runCommand).toHaveBeenCalledWith("pdftotext", ["-q", "-bbox-layout", "/profile/a.pdf", "-"], undefined, signal, 30000);
});

const at = (text: string, xMin: number, xMax: number, yMin = 0) => ({ text, xMin, xMax, yMin });
test("splits the sidebar at the widest gap no line crosses and reads it first", () => {
  expect(columnSplit([at("Contact", 30, 90), at("Indented", 50, 120), at("Name", 200, 400), at("Bullet", 220, 500)])).toBe(200);
  expect(columnSplit([at("Wide", 30, 500), at("Indented", 60, 400)])).toBeNull();
  const order = readingOrder([
    { page: 1, width: 600, lines: [at("Name", 200, 300, 10), at("Contact", 30, 90, 10), at("a@example.com", 30, 120, 20), at("Summary", 200, 260, 20), at("Page 1 of 2", 250, 320, 800)] },
    { page: 2, width: 600, lines: [at("Contact", 30, 500, 20), at("Later", 30, 200, 10)] },
    { page: 3, width: 600, lines: [at("Contact", 300, 400, 20), at("Left", 30, 200, 10)] },
  ]);
  expect(order).toEqual({ sidebar: ["Contact", "a@example.com"], main: ["Name", "Summary", "Later", "Contact", "Left", "Contact"] });
});

test("reads periods, durations and dates in English and Portuguese", () => {
  expect(parsePeriod("January 2024 - Present (1 year)")).toEqual({ start: "2024-01", end: "Present", months: 12 });
  expect(parsePeriod("Sept. 2019 – Dec 2020")).toEqual({ start: "2019-09", end: "2020-12", months: null });
  expect(parsePeriod("março de 2020 - o momento (4 anos 2 meses)")).toEqual({ start: "2020-03", end: "Present", months: 50 });
  expect(parsePeriod("2016 - 2020 (less than a year)")).toEqual({ start: "2016", end: "2020", months: null });
  expect(parsePeriod("Senior Engineer")).toBeNull();
  expect(durationMonths("1 ano 1 mês")).toBe(13);
  expect(durationMonths("2 years ago")).toBeNull();
  expect([exportDate("Atual"), exportDate("dezembro de 2019"), exportDate("2019")]).toEqual(["Present", "2019-12", "2019"]);
  expect([monthIndex("2020-03"), monthIndex("2020"), monthIndex("Present")]).toEqual([2020 * 12 + 2, 2020 * 12, null]);
});

test("titles open sections and content before the first one is the header", () => {
  expect([sectionTitle(" experiência "), sectionTitle("Formação acadêmica"), sectionTitle("Honors-Awards"), sectionTitle("Projects")]).toEqual(["experience", "education", "honors", null]);
  expect(splitSections(["Name", "Summary", "One", "Experience", "Role", "Summary", "Two"])).toEqual({ header: ["Name"], sections: { summary: ["One", "Two"], experience: ["Role"] } });
});

test("tells locations from bullets and joins wrapped bullet lines", () => {
  expect(["São Paulo, Brazil", "Remote", "Híbrido", "Greater Lisbon Area"].map(looksLikeLocation)).toEqual([true, true, true, true]);
  expect(["- Lisbon, Portugal", "Built APIs in Node.", "built the thing", "x".repeat(81)].map(looksLikeLocation)).toEqual([false, false, false, false]);
  expect(joinBullets(["Led the", "migration.", "* Shipped:", "metrics.", "", "-", "Wrote " + "y".repeat(600)])).toEqual(["Led the migration.", "Shipped:", "metrics.", ("Wrote " + "y".repeat(600)).slice(0, 500)]);
});

test("anchors roles on period lines, with or without a company line", () => {
  expect(parseExperience(["2020 - 2021", "Engineer", "2019 - 2020", "Builder"]).slice(1)).toEqual([]);
  expect(parseExperience(["Engineer", "2019 - 2020", "Built tools."])).toEqual([
    { company: "", title: "Engineer", start: "2019", end: "2020", location: "", bullets: ["Built tools."] },
  ]);
  // A role starting after the company's whole span closes the group: the next line before a title is a company again.
  expect(parseExperience(["Acme", "1 year", "Lead", "Jan 2020 - Dec 2020 (1 year)", "Beta", "Dev", "2018 - 2019", "Remote"]).map(role => [role.company, role.title, role.location])).toEqual([["Acme", "Lead", ""], ["Beta", "Dev", "Remote"]]);
  expect(parseExperience(["Acme", "3 years", "Lead", "2010 - Present", "Dev", "2010 - 2011"]).map(role => role.company)).toEqual(["Acme", "Acme"]);
});

test("reads education with dates, a single year or none", () => {
  expect(parseEducation(["Example College", "Associate,", "Design · (2015)", "Night School", "(2010 - 2011)", "Lone School"])).toEqual([
    { school: "Example College", degree: "Associate, Design", start: "", end: "2015" },
    { school: "Night School", degree: "", start: "2010", end: "2011" },
    { school: "Lone School", degree: "", start: "", end: "" },
  ]);
});
