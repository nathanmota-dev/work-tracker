import { expect, it } from "vitest"
import { formatDate } from "./utils"

it("formats dates as dd/mm/yyyy in local time", () => {
  expect(formatDate(new Date(2026, 10, 5, 23, 30))).toBe("05/11/2026")
  expect(formatDate(new Date(2026, 0, 31).getTime())).toBe("31/01/2026")
  // A calendar day is never shifted by the time zone.
  expect(formatDate("2026-11-25")).toBe("25/11/2026")
  expect(formatDate(new Date(2026, 10, 25, 12).toISOString())).toBe("25/11/2026")
})

it("returns an empty string for missing or invalid dates", () => {
  for (const value of [null, undefined, "", "not a date"]) expect(formatDate(value)).toBe("")
})
