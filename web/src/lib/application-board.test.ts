import { describe, expect, it } from "vitest"
import {
  faviconUrl,
  localDateTime,
  matchesApplication,
  quietPath,
  type TrackedApplication,
} from "./application-board"

const application = {
  company_name: "São José",
  role_title: "Senior Engineer",
  role_type: "front_end",
  stack: ["React", "TypeScript"],
} as TrackedApplication
describe("application display helpers", () => {
  it("reads the quiet scan without a query for the default threshold", () => {
    expect(quietPath(60)).toBe("application-board/quiet")
    expect(quietPath(90)).toBe("application-board/quiet?days=90")
  })
  it("searches accents, role type and technologies without requiring optional fields", () => {
    for (const query of ["SAO JOSE", "senior", "front-end", "typescript", ""])
      expect(matchesApplication(application, query)).toBe(true)
    expect(matchesApplication(application, "Python")).toBe(false)
    expect(
      matchesApplication(
        { ...application, role_title: null, role_type: null, stack: [] },
        "sao",
      ),
    ).toBe(true)
  })
  it("prefers the company origin and safely falls back to the job origin", () => {
    expect(
      faviconUrl({
        company_url: "https://acme.com/about",
        external_url: "https://ats.com/role",
      }),
    ).toBe("https://acme.com/favicon.ico")
    expect(
      faviconUrl({
        company_url: null,
        external_url: "https://ats.com/role?q=x",
      }),
    ).toBe("https://ats.com/favicon.ico")
    expect(
      faviconUrl({ company_url: null, external_url: "file:///tmp/icon" }),
    ).toBeUndefined()
    expect(
      faviconUrl({ company_url: null, external_url: "invalid" }),
    ).toBeUndefined()
  })
  it("converts timestamps into local form values without shifting the selected instant", () => {
    const timestamp = "2026-10-10T13:45:00.000Z"
    expect(new Date(localDateTime(timestamp)).toISOString()).toBe(timestamp)
  })
})
