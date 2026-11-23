/** Deadlines within this many days (inclusive) count as urgent. */
export const SOON_DAYS = 7;

export type DeadlineLevel = "overdue" | "soon" | "upcoming" | "none";
export interface DeadlineUrgency {
  level: DeadlineLevel;
  daysLeft: number | null;
}

const DAY_MS = 86_400_000;

/** Returns the date as `YYYY-MM-DD` when the text is a real calendar date, otherwise null. */
export function parseDeadline(text: string | null | undefined): string | null {
  const value = text?.trim();
  const match = value && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? value : null;
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localToday(at: Date = new Date()): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** Compares local calendar dates only: no time of day and no time zone. */
export function deadlineUrgency(deadline: string | null | undefined, today: string = localToday()): DeadlineUrgency {
  const date = parseDeadline(deadline);
  const current = parseDeadline(today);
  if (!date || !current) return { level: "none", daysLeft: null };
  const daysLeft = dayNumber(date) - dayNumber(current);
  if (daysLeft < 0) return { level: "overdue", daysLeft };
  return { level: daysLeft <= SOON_DAYS ? "soon" : "upcoming", daysLeft };
}
