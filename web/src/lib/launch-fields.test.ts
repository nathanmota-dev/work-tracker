import { afterEach, describe, expect, it, vi } from "vitest"
import { readLaunchFields, writeLaunchFields } from "./launch-fields"

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe("launch fields", () => {
  it("keeps only role and location per skill", () => {
    writeLaunchFields("job-scout", { query: "Backend", location: "Recife", extra: "ignored", company: "Acme" })
    expect(readLaunchFields("job-scout")).toEqual({ query: "Backend", location: "Recife" })
    expect(readLaunchFields("deep-scout")).toEqual({})
  })

  it("ignores malformed or unavailable storage", () => {
    localStorage.setItem("work-tracker-launch-fields-v1:job-scout", "{bad")
    expect(readLaunchFields("job-scout")).toEqual({})
    localStorage.setItem("work-tracker-launch-fields-v1:job-scout", JSON.stringify({ query: 3, location: "Lisbon" }))
    expect(readLaunchFields("job-scout")).toEqual({ location: "Lisbon" })
    localStorage.setItem("work-tracker-launch-fields-v1:job-scout", "1")
    expect(readLaunchFields("job-scout")).toEqual({})
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full") })
    expect(() => writeLaunchFields("job-scout", { query: "x" })).not.toThrow()
  })
})
