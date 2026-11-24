/** Section titles of the LinkedIn export, in English and Portuguese. */
export type SectionKey = "contact" | "topSkills" | "languages" | "certifications" | "honors" | "publications" | "summary" | "experience" | "education";

const TITLES: Record<SectionKey, string[]> = {
  contact: ["Contact", "Contato"],
  topSkills: ["Top Skills", "Principais competências"],
  languages: ["Languages", "Idiomas"],
  certifications: ["Certifications", "Certificações"],
  honors: ["Honors-Awards", "Prêmios"],
  publications: ["Publications", "Publicações"],
  summary: ["Summary", "Resumo"],
  experience: ["Experience", "Experiência"],
  education: ["Education", "Formação acadêmica"],
};
/** Titles that only appear in the sidebar of the first page. */
export const SIDEBAR_SECTIONS: SectionKey[] = ["contact", "topSkills", "languages", "certifications", "honors", "publications"];

const byTitle = new Map(Object.entries(TITLES).flatMap(([key, titles]) => titles.map(title => [title.toLocaleLowerCase("pt"), key as SectionKey])));
/** The section a line opens, or null when it is content. */
export function sectionTitle(line: string): SectionKey | null {
  return byTitle.get(line.trim().normalize("NFC").toLocaleLowerCase("pt")) ?? null;
}

/**
 * Split lines into the content before the first title and the content of each
 * section. A repeated title (as a page break sometimes produces) continues it.
 */
export function splitSections(lines: string[]): { header: string[]; sections: Partial<Record<SectionKey, string[]>> } {
  const header: string[] = [];
  const sections: Partial<Record<SectionKey, string[]>> = {};
  let current: string[] = header;
  for (const line of lines) {
    const key = sectionTitle(line);
    if (key) current = sections[key] ??= [];
    else current.push(line);
  }
  return { header, sections };
}
