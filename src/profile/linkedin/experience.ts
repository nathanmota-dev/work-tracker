import type { LinkedInEducation, LinkedInExperience } from "../types.ts";
import { durationMonths, exportDate, monthIndex, parsePeriod } from "./dates.ts";

export const MAX_EXPERIENCES = 30;
const MAX_BULLET = 500;
const MARKER = /^[-•·*–▪●◦]\s*/;
const LOCATION_WORDS = /^(?:remote|remoto|hybrid|híbrido|on-site|presencial)\b/iu;
const CAPITALIZED = /^(?:\p{Lu}[\p{L}'’-]*\s?){1,4}$/u;

/** The optional line after a period: `City, Country`, a work mode or a short proper name. */
export function looksLikeLocation(line: string): boolean {
  if (MARKER.test(line) || line.length > 80 || /[.!?;:]$/.test(line)) return false;
  return line.includes(",") || LOCATION_WORDS.test(line) || CAPITALIZED.test(line);
}
/** Wrapped lines joined into bullets: a marker or a finished sentence starts the next one. */
export function joinBullets(lines: string[]): string[] {
  const bullets: string[] = [];
  for (const line of lines) {
    const text = line.replace(MARKER, "").trim();
    if (!text) continue;
    if (MARKER.test(line) || !bullets.length || /[.!?;:]$/.test(bullets.at(-1)!)) bullets.push(text);
    else bullets[bullets.length - 1] += ` ${text}`;
  }
  return bullets.map(bullet => bullet.slice(0, MAX_BULLET));
}

type Group = { company: string; months: number; from: number; to: number };
type Role = { header: number; period: number; entry: LinkedInExperience };
/** A multi-role company closes once its roles span the company's total duration. */
function extend(group: Group, start: string, end: string, months: number | null): Group | null {
  // Period lines always carry a year, so both ends have a month index.
  const from = monthIndex(start)!;
  const to = end === "Present" ? from + Math.max((months ?? 1) - 1, 0) : monthIndex(end)!;
  const next = { ...group, from: Math.min(group.from, from), to: Math.max(group.to, to) };
  return next.to - next.from + 1 >= next.months - 1 ? null : next;
}

/**
 * Roles anchored on their period lines: the line before a period is the title
 * and the one before it (or before the total-duration line) is the company.
 * Roles after a total-duration line inherit its company until their periods
 * cover it. An optional location follows the period; bullets run until the
 * next role's first line.
 */
export function parseExperience(lines: string[]): LinkedInExperience[] {
  const roles: Role[] = [];
  let group: Group | null = null;
  let floor = 0;
  lines.forEach((line, p) => {
    const period = parsePeriod(line);
    if (!period || p - 1 < floor) return;
    const months = p - 3 >= floor ? durationMonths(lines[p - 2]!) : null;
    let header = p - 1;
    let company = group?.company ?? "";
    if (months !== null) { header = p - 3; company = lines[header]!; group = { company, months, from: Infinity, to: -Infinity }; }
    else if (!group && p - 2 >= floor) { header = p - 2; company = lines[header]!; }
    roles.push({ header, period: p, entry: { company, title: lines[p - 1]!, start: period.start, end: period.end, location: "", bullets: [] } });
    if (group) group = extend(group, period.start, period.end, period.months);
    floor = p + 1;
  });
  return roles.slice(0, MAX_EXPERIENCES).map((role, index) => {
    const body = lines.slice(role.period + 1, roles[index + 1]?.header ?? lines.length);
    const location = body[0] !== undefined && looksLikeLocation(body[0]) ? body.shift()! : "";
    return { ...role.entry, location, bullets: joinBullets(body) };
  });
}
export const countRoles = (lines: string[]) => lines.filter(line => parsePeriod(line)).length;

const EDUCATION_DATES = /\(([^()]*\d{4}[^()]*)\)\s*$/;
/** `School` then `Degree · (2016 - 2020)`; entries without dates pair school and degree lines. */
export function parseEducation(lines: string[]): LinkedInEducation[] {
  const entries: LinkedInEducation[] = [];
  let buffer: string[] = [];
  for (const line of lines) {
    const match = EDUCATION_DATES.exec(line);
    if (!match) { buffer.push(line); continue; }
    const period = parsePeriod(match[1]!);
    const parts = [...buffer, line.slice(0, match.index).replace(/[\s·•,-]+$/u, "")].filter(Boolean);
    entries.push({ school: parts[0] ?? "", degree: parts.slice(1).join(" "), start: period?.start ?? "", end: period?.end ?? exportDate(match[1]!) });
    buffer = [];
  }
  for (let i = 0; i < buffer.length; i += 2) entries.push({ school: buffer[i]!, degree: buffer[i + 1] ?? "", start: "", end: "" });
  return entries;
}
