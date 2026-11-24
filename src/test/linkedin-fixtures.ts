/**
 * Synthetic `pdftotext -bbox-layout` output of LinkedIn "Save to PDF" exports
 * for a fictional person. Page 1 has the sidebar at x=36 and the main column
 * at x=220; later pages have one column. Every page ends with its footer.
 */
type Column = "side" | "main";
export type FixtureLine = string | [Column, string];

const X = { side: 36, main: 220 } as const;
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function line(text: string, column: Column, y: number): string {
  const width = column === "side" ? Math.min(text.length * 5, 140) : text.length * 5;
  const words = text.split(" ").map(word => `<word xMin="${X[column]}" yMin="${y}" xMax="${X[column] + 10}" yMax="${y + 10}">${escape(word)}</word>`).join("");
  return `<line xMin="${X[column]}.000000" yMin="${y}.000000" xMax="${X[column] + width}.000000" yMax="${y + 10}.000000">${words}</line>`;
}
/** Pages of lines; a `[column, text]` line on any page goes to that column, plain strings to the main one. */
export function bboxXhtml(pages: FixtureLine[][], footer: (page: number, total: number) => string = (page, total) => `Page ${page} of ${total}`): string {
  const body = pages.map((lines, index) => {
    const y = { side: 40, main: 40 };
    const rendered = lines.map(entry => {
      const [column, text] = typeof entry === "string" ? (["main", entry] as const) : entry;
      y[column] += 14;
      return line(text, column, y[column]);
    });
    if (footer) rendered.push(line(footer(index + 1, pages.length), "main", 800));
    return `<page width="595.000000" height="842.000000"><flow><block>${rendered.join("")}</block></flow></page>`;
  });
  return `<!DOCTYPE html><html><body><doc>${body.join("")}</doc></body></html>`;
}
const side = (...texts: string[]): FixtureLine[] => texts.map(text => ["side", text] as FixtureLine);

/** English export: two roles at one company and a role cut by the page break. */
export const ENGLISH_EXPORT: FixtureLine[][] = [
  [
    ...side("Contact", "alex@example.com", "Top Skills", "TypeScript", "React", "Languages", "English (Full Professional)", "Spanish (Limited", "Working)", "Certifications", "Example Cloud Practitioner", "Publications", "Notes on Testing"),
    "Alex Example", "Senior Engineer at Northwind Labs", "Lisbon, Portugal", "Summary", "Engineer building web platforms", "with TypeScript.",
    "Experience", "Northwind Labs", "2 years 1 month", "Senior Software Engineer", "August 2023 - Present (1 year 5 months)", "Lisbon, Portugal",
    "- Led the billing migration", "to TypeScript.", "• Built a design system.", "Software Engineer", "December 2022 - July 2023 (8 months)", "Implemented dashboards in React.",
  ],
  ["Contoso Analytics", "Backend Developer", "June 2019 - November 2022 (3 years 6 months)", "Remote", "Designed REST APIs.", "Fabrikam Studio", "Junior Developer"],
  ["March 2017 - May 2019 (2 years 3 months)", "Maintained internal tools.", "Education", "Example University", "Bachelor of Science, Computer Science · (2013 - 2017)", "Example Language School", "English"],
];
/** The same profile exported from an account in Portuguese, without a summary. */
export const PORTUGUESE_EXPORT: FixtureLine[][] = [
  [
    ...side("Contato", "alex@example.com", "Principais competências", "TypeScript", "Idiomas", "Português (Nativo ou bilíngue)"),
    "Alex Exemplo", "Engenheiro de software", "Experiência", "Northwind Labs", "Engenheiro de Software Sênior", "agosto de 2023 - o momento (1 ano 5 meses)", "Lisboa, Portugal", "Liderou a migração do faturamento.",
  ],
  ["Formação acadêmica", "Universidade Exemplo", "Bacharelado, Ciência da Computação · (2013 - 2017)"],
];
