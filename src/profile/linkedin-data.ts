import type { LinkedInProfile } from "./types.ts";

/**
 * A LinkedIn export in the resume data file's shape, so the profile, the base
 * resume and tailoring read one format. The export has no projects and no
 * skill groups: its top skills become the flat skill list.
 */
export function linkedinData(profile: LinkedInProfile): Record<string, unknown> {
  const { contact } = profile;
  const social = [["LinkedIn", contact.linkedin], ["GitHub", contact.github]].filter(([, url]) => url).map(([name, url]) => ({ name, url }));
  return {
    name: profile.name, headline: profile.headline, location: profile.location, summary: profile.summary,
    ...(contact.website && { personalWebsiteUrl: contact.website }),
    contact: { email: contact.email, tel: contact.phone, social },
    skills: profile.topSkills, languages: profile.languages, certifications: profile.certifications,
    work: profile.experience.map(role => ({ company: role.company, title: role.title, location: role.location, start: role.start, end: role.end, highlights: role.bullets })),
    education: profile.education.map(course => ({ school: course.school, degree: course.degree, start: course.start, end: course.end })),
  };
}
