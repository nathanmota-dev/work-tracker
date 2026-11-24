/** Month names of the export, English (full and abbreviated) and Portuguese. */
const MONTHS: Record<string, number> = {};
[
  ["january", "jan", "janeiro"], ["february", "feb", "fevereiro", "fev"], ["march", "mar", "março"], ["april", "apr", "abril", "abr"],
  ["may", "maio", "mai"], ["june", "jun", "junho"], ["july", "jul", "julho"], ["august", "aug", "agosto", "ago"],
  ["september", "sep", "sept", "setembro", "set"], ["october", "oct", "outubro", "out"], ["november", "nov", "novembro"], ["december", "dec", "dezembro", "dez"],
].forEach((names, index) => { for (const name of names) MONTHS[name] = index + 1; });

const MONTH = `(?:${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|")})\\.?`;
const POINT = `(?:${MONTH}\\s+(?:de\\s+)?)?\\d{4}`;
const PRESENT = "Present|o momento|Presente|Atual";
const PERIOD = new RegExp(`^(${POINT})\\s*[-–—]\\s*(${POINT}|${PRESENT})(?:\\s*\\(([^)]*)\\))?$`, "iu");
const UNIT = "(?:years?|months?|anos?|m[eê]s|meses)";
const DURATION = new RegExp(`^(?:\\d+\\s+${UNIT}\\s*)+$`, "iu");

/** `Month YYYY`, `mês de YYYY` or `YYYY` as `YYYY-MM` or `YYYY`; `Present` stays. */
export function exportDate(text: string): string {
  const value = text.trim();
  if (new RegExp(`^(?:${PRESENT})$`, "i").test(value)) return "Present";
  const year = /\d{4}/.exec(value)![0];
  const month = MONTHS[value.toLocaleLowerCase("pt").split(/[\s.]+/)[0]!];
  return month ? `${year}-${String(month).padStart(2, "0")}` : year;
}
/** A period line such as `January 2024 - Present (1 year)`; null for any other line. */
export function parsePeriod(line: string): { start: string; end: string; months: number | null } | null {
  const match = PERIOD.exec(line.trim());
  if (!match) return null;
  return { start: exportDate(match[1]!), end: exportDate(match[2]!), months: match[3] ? durationMonths(match[3]) : null };
}
/** Months of a duration such as `2 years 1 month` or `1 ano 3 meses`; null when it is not one. */
export function durationMonths(text: string): number | null {
  const value = text.trim();
  if (!DURATION.test(value)) return null;
  let months = 0;
  for (const [, amount, unit] of value.matchAll(/(\d+)\s+(\S+)/g)) months += Number(amount) * (/^(?:year|ano)/i.test(unit!) ? 12 : 1);
  return months;
}
/** Month index of a date for period arithmetic; a year alone counts as January. */
export function monthIndex(date: string): number | null {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(date);
  return match ? Number(match[1]) * 12 + Number(match[2] ?? 1) - 1 : null;
}
