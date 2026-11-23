import { describe, expect, test } from "vitest";
import { SOON_DAYS, deadlineUrgency, localToday, parseDeadline } from "./urgency.ts";

describe("parseDeadline", () => {
  test("accepts real dates and rejects everything else", () => {
    expect(parseDeadline("2026-12-01")).toBe("2026-12-01");
    expect(parseDeadline(" 2026-12-01 ")).toBe("2026-12-01");
    expect(parseDeadline("2026-02-31")).toBeNull();
    expect(parseDeadline("2026-13-40")).toBeNull();
    expect(parseDeadline("2026-1-5")).toBeNull();
    expect(parseDeadline("01/12/2026")).toBeNull();
    expect(parseDeadline("")).toBeNull();
    expect(parseDeadline(null)).toBeNull();
    expect(parseDeadline(undefined)).toBeNull();
  });

  test("knows leap years", () => {
    expect(parseDeadline("2028-02-29")).toBe("2028-02-29");
    expect(parseDeadline("2026-02-29")).toBeNull();
  });
});

describe("deadlineUrgency", () => {
  const today = "2026-11-23";
  test("classifies the boundaries", () => {
    expect(SOON_DAYS).toBe(7);
    expect(deadlineUrgency("2026-11-22", today)).toEqual({ level: "overdue", daysLeft: -1 });
    expect(deadlineUrgency("2026-11-23", today)).toEqual({ level: "soon", daysLeft: 0 });
    expect(deadlineUrgency("2026-11-30", today)).toEqual({ level: "soon", daysLeft: 7 });
    expect(deadlineUrgency("2026-12-01", today)).toEqual({ level: "upcoming", daysLeft: 8 });
  });

  test("handles month, year and leap-day rollover", () => {
    expect(deadlineUrgency("2027-01-02", "2026-12-30")).toEqual({ level: "soon", daysLeft: 3 });
    expect(deadlineUrgency("2028-03-01", "2028-02-28")).toEqual({ level: "soon", daysLeft: 2 });
    expect(deadlineUrgency("2027-03-01", "2027-02-28")).toEqual({ level: "soon", daysLeft: 1 });
  });

  test("ignores missing or invalid values", () => {
    expect(deadlineUrgency(null, today)).toEqual({ level: "none", daysLeft: null });
    expect(deadlineUrgency("", today)).toEqual({ level: "none", daysLeft: null });
    expect(deadlineUrgency("2026-02-31", today)).toEqual({ level: "none", daysLeft: null });
    expect(deadlineUrgency("2026-12-01", "bad")).toEqual({ level: "none", daysLeft: null });
  });

  test("localToday uses the local calendar date", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(deadlineUrgency("2026-01-05")).toBeDefined();
  });
});
