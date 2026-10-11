import { request, publish, type Row } from "@/lib/api"

export interface CandidateProfile {
  firstName: string
  lastName: string
  email: string
  linkedinUsername: string
}
export const emptyProfile: CandidateProfile = {
  firstName: "",
  lastName: "",
  email: "",
  linkedinUsername: "",
}

export function linkedinUsername(value: string): string {
  const input = value.trim().replace(/^@/, "")
  if (!input) return ""
  if (/^(https?:\/\/)?([\w-]+\.)?linkedin\.com\//i.test(input)) {
    const url = new URL(
      /^https?:\/\//i.test(input) ? input : `https://${input}`,
    )
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/)
    if (!match)
      throw new Error(
        "Use a LinkedIn profile URL, such as linkedin.com/in/your-name.",
      )
    return linkedinUsername(decodeURIComponent(match[1]))
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(input))
    throw new Error("Enter your LinkedIn username or profile URL.")
  return input
}
export function candidateFromAnswers(rows: Row[]): CandidateProfile {
  const answers = Object.fromEntries(
    rows.map((row) => [String(row.key), String(row.value ?? "")]),
  )
  let username = ""
  try {
    username = linkedinUsername(answers.linkedin_url ?? "")
  } catch {
    /* malformed legacy answer can be repaired in Settings */
  }
  return {
    firstName: answers.first_name ?? "",
    lastName: answers.last_name ?? "",
    email: answers.email ?? "",
    linkedinUsername: username,
  }
}
export function candidateName(profile: CandidateProfile) {
  return [profile.firstName.trim(), profile.lastName.trim()]
    .filter(Boolean)
    .join(" ")
}
export async function saveCandidateProfile(profile: CandidateProfile) {
  const username = linkedinUsername(profile.linkedinUsername)
  const answers = [
    { key: "first_name", value: profile.firstName.trim(), category: "contact" },
    { key: "last_name", value: profile.lastName.trim(), category: "contact" },
    { key: "full_name", value: candidateName(profile), category: "contact" },
    { key: "email", value: profile.email.trim(), category: "contact" },
    {
      key: "linkedin_url",
      value: username
        ? `https://www.linkedin.com/in/${encodeURIComponent(username)}/`
        : "",
      category: "links",
    },
  ]
  // The existing answer API saves individual fields. Keep the draft on failure so
  // a retry safely completes any partially saved changes through its upsert.
  try {
    for (const answer of answers) await request("answer", answer)
  } finally {
    publish({ type: "changed", table: "applicant_answers" })
  }
}
export function withCandidateProfile(
  profile: CandidateProfile,
  skill: string,
  params: Record<string, string>,
): Record<string, string> {
  const username = params.username?.trim() || profile.linkedinUsername
  const name = params.displayName?.trim() || candidateName(profile)
  const identity = [
    name ? `Name: ${name}` : "",
    username
      ? `LinkedIn: https://www.linkedin.com/in/${encodeURIComponent(username)}/`
      : "",
    ["resume-tailor", "portal-filler"].includes(skill) && profile.email
      ? `Email: ${profile.email}`
      : "",
  ].filter(Boolean)
  return {
    ...params,
    ...(username ? { username } : {}),
    ...(name ? { displayName: name } : {}),
    ...(identity.length
      ? {
          extra: [
            `Saved candidate details (use these instead of asking again):\n${identity.join("\n")}`,
            params.extra,
          ]
            .filter(Boolean)
            .join("\n\n"),
        }
      : {}),
  }
}
