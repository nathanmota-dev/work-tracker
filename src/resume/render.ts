import type { ResumeDocument } from "./document.ts";
import { displayUrl, latexText, latexUrl, resumeDate, resumePeriod } from "./latex.ts";
import { RESUME_PREAMBLE } from "./template.ts";

const t = latexText;
const bullets = (items: string[], indent: string) => items.length
  ? [`${indent}\\resumeSubHeadingList`, ...items.map(item => `${indent}    \\resumeItem{\\textbullet\\ ${t(item)}}`), `${indent}\\resumeSubHeadingListEnd`]
  : [];
const subheading = (indent: string, title: string, aside: string, subtitle: string, detail: string) =>
  [`${indent}\\resumeSubheading`, `${indent}    {${t(title)}}{${t(aside)}}`, `${indent}    {${t(subtitle)}}{${t(detail)}}`];
const href = (url: string, label: string) => { const target = latexUrl(url); return target ? `\\href{${target}}{${t(label)}}` : t(label); };

function header(doc: ResumeDocument): string[] {
  const { location, phone, email } = doc.contact;
  const first = [t(location), t(phone), email && href(`mailto:${email}`, email)].filter(Boolean);
  const second = doc.links.filter(url => latexUrl(url)).map(url => href(url, displayUrl(url)));
  const lines = [first.join(" $|$ "), second.join(" $|$\n  ")].filter(Boolean);
  return ["\\begin{center}", `  \\textbf{\\Huge ${t(doc.name)}} \\\\`, ...(lines.length ? [`  \\small ${lines.join(" \\\\\n  ")}`] : []), "\\end{center}"];
}
function education(doc: ResumeDocument): string[] {
  if (!doc.education.length) return [];
  const entries = doc.education.flatMap((item, index) => [...(index ? ["  \\vspace{4pt}"] : []), ...subheading("  ", item.school, item.location, item.degree, resumePeriod(item.start, item.end))]);
  return ["\\section{Formação Acadêmica}", "\\resumeSubHeadingList", ...entries, "\\resumeSubHeadingListEnd"];
}
function skills(doc: ResumeDocument): string[] {
  if (!doc.skills.length) return [];
  const lines = doc.skills.map(group => (group.name ? `\\textbf{${t(group.name)}}{: ${t(group.items.join(", "))}}` : t(group.items.join(", "))));
  return ["\\section{Habilidades}", " \\begin{itemize}[leftmargin=0.15in, label={}]", "    \\small{\\item{", ...lines.map((line, index) => `     ${line}${index < lines.length - 1 ? " \\\\" : ""}`), "    }}", " \\end{itemize}", " \\vspace{-12pt}"];
}
function work(doc: ResumeDocument): string[] {
  if (!doc.work.length) return [];
  const entries = doc.work.flatMap(role => ["", ...subheading("", role.company, resumePeriod(role.start, role.end), role.title, role.detail), ...bullets(role.highlights, "  ")]);
  return ["\\section{Experiência Profissional}", "\\resumeSubHeadingList", ...entries, "", "\\resumeSubHeadingListEnd"];
}
function projects(doc: ResumeDocument): string[] {
  if (!doc.projects.length) return [];
  const entries = doc.projects.flatMap((project, index) => [...(index ? [""] : []), ...subheading("  ", project.name, resumeDate(project.date), project.description, project.techStack.join(", ")), ...bullets(project.highlights, "      ")]);
  return ["\\section{Projetos}", "\\resumeSubHeadingList", ...entries, "\\resumeSubHeadingListEnd"];
}
function certifications(doc: ResumeDocument): string[] {
  if (!doc.certifications.length) return [];
  return ["\\section{Certificações}", "\\resumeSubHeadingList", ...doc.certifications.map(item => `  \\resumeItem{\\textbullet\\ ${t(item)}}`), "\\resumeSubHeadingListEnd"];
}
const summary = (doc: ResumeDocument) => (doc.summary ? ["\\section{Resumo Profissional}", `\\small{${t(doc.summary)}}`] : []);

/** The complete `resume.tex` of a base resume: the fixed preamble and one section per filled part of the profile. */
export function renderResume(doc: ResumeDocument): string {
  const sections = [header(doc), summary(doc), education(doc), skills(doc), work(doc), projects(doc), certifications(doc)].filter(lines => lines.length);
  return `${RESUME_PREAMBLE}\n\\begin{document}\n\n${sections.map(lines => lines.join("\n")).join("\n\n")}\n\n\\end{document}\n`;
}
