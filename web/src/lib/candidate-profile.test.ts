import { beforeEach, expect, it, vi } from "vitest"
import {
  candidateFromAnswers,
  candidateName,
  emptyProfile,
  linkedinUsername,
  saveCandidateProfile,
  withCandidateProfile,
} from "./candidate-profile"
import { publish, request } from "./api"
vi.mock("./api", () => ({ request: vi.fn(), publish: vi.fn() }))
const profile = {
  firstName: " Ana ",
  lastName: " Silva ",
  email: " ana@example.com ",
  linkedinUsername: "ana-silva",
}
beforeEach(() => {
  vi.mocked(request).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(publish).mockClear()
})
it.each([
  ["", ""],
  [" @ana-silva ", "ana-silva"],
  ["José-123", "José-123"],
  ["linkedin.com/in/ana/?trk=x", "ana"],
  ["https://www.linkedin.com/in/jos%C3%A9/", "josé"],
])("normalizes %s", (input, expected) =>
  expect(linkedinUsername(input)).toBe(expected),
)
it.each([
  "https://example.com/in/ana",
  "https://linkedin.com/company/acme",
  "bad/user",
  "https://linkedin.com/in/%E0%A4%A",
])("rejects invalid identity %s", (input) =>
  expect(() => linkedinUsername(input)).toThrow(),
)
it("handles absent and malformed legacy answers and builds trimmed names", () => {
  expect(candidateFromAnswers([])).toEqual(emptyProfile)
  expect(
    candidateFromAnswers([
      { key: "linkedin_url", value: "broken/url" },
      { key: "first_name", value: null },
    ]),
  ).toEqual(emptyProfile)
  expect(candidateName(profile)).toBe("Ana Silva")
  expect(candidateName({ ...emptyProfile, firstName: " Ana " })).toBe("Ana")
})
it("saves canonical fields and notifies once", async () => {
  await saveCandidateProfile(profile)
  expect(vi.mocked(request).mock.calls).toEqual([
    ["answer", { key: "first_name", value: "Ana", category: "contact" }],
    ["answer", { key: "last_name", value: "Silva", category: "contact" }],
    ["answer", { key: "full_name", value: "Ana Silva", category: "contact" }],
    ["answer", { key: "email", value: "ana@example.com", category: "contact" }],
    [
      "answer",
      {
        key: "linkedin_url",
        value: "https://www.linkedin.com/in/ana-silva/",
        category: "links",
      },
    ],
  ])
  expect(publish).toHaveBeenCalledExactlyOnceWith({
    type: "changed",
    table: "applicant_answers",
  })
})
it("stops after partial failure, publishes invalidation and allows retry", async () => {
  vi.mocked(request)
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error("offline"))
  await expect(saveCandidateProfile(profile)).rejects.toThrow("offline")
  expect(request).toHaveBeenCalledTimes(2)
  expect(publish).toHaveBeenCalledOnce()
  await saveCandidateProfile(profile)
  expect(request).toHaveBeenCalledTimes(7)
})
it("validates before writing and clears an absent LinkedIn URL", async () => {
  await expect(
    saveCandidateProfile({ ...profile, linkedinUsername: "bad/url" }),
  ).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
  await saveCandidateProfile(emptyProfile)
  expect(request).toHaveBeenLastCalledWith("answer", {
    key: "linkedin_url",
    value: "",
    category: "links",
  })
})
it("preserves explicit identity/context and includes email only for resume/portal skills", () => {
  const params = withCandidateProfile(profile, "resume-tailor", {
    username: "other",
    displayName: "Other",
    extra: "Context",
  })
  expect(params).toMatchObject({ username: "other", displayName: "Other" })
  expect(params.extra).toContain("Context")
  expect(params.extra).toContain("Email:")
  expect(withCandidateProfile(profile, "portal-filler", {}).extra).toContain(
    "Email:",
  )
  expect(
    withCandidateProfile(profile, "profile-optimizer", {}).extra,
  ).not.toContain("Email:")
  expect(
    withCandidateProfile(emptyProfile, "profile-optimizer", {
      extra: "Context",
    }),
  ).toEqual({ extra: "Context" })
})
