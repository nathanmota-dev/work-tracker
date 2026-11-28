import { expect, test } from "vitest";
import type { ResumeDocument } from "./document.ts";
import { renderResume } from "./render.ts";
import { RESUME_PREAMBLE } from "./template.ts";

const empty: ResumeDocument = { name: "Ada Example", contact: { location: "", phone: "", email: "" }, links: [], summary: "", education: [], skills: [], work: [], projects: [], certifications: [] };
const body = (doc: ResumeDocument) => renderResume(doc).slice(RESUME_PREAMBLE.length);

test("renders every filled section in the resume's order with escaped texts", () => {
  const doc: ResumeDocument = {
    name: "Ada Example",
    contact: { location: "Campinas, SP", phone: "(19) 90000-0000", email: "ada@example.com" },
    links: ["https://www.linkedin.com/in/ada/", "https://github.com/ada"],
    summary: "C# & .NET developer.",
    education: [
      { school: "State University", location: "Campinas, SP", degree: "BSc", start: "2019-08", end: "2023-08" },
      { school: "Tech School", location: "", degree: "Technician", start: "2015", end: "2016" },
    ],
    skills: [{ name: "Back-End", items: ["C#", ".NET"] }, { name: "Data", items: ["SQL"] }],
    work: [{ company: "Northwind", title: "Developer", start: "2024-01", end: "Present", detail: "Angular, C#", highlights: ["Built 100% of it."] }],
    projects: [
      { name: "Tracker", description: "Full-stack app", date: "2026-05", techStack: ["Next.js"], highlights: ["Imports bank data."] },
      { name: "Site", description: "", date: "", techStack: [], highlights: [] },
    ],
    certifications: ["AWS_Cert"],
  };
  const tex = renderResume(doc);
  expect(tex.startsWith(RESUME_PREAMBLE)).toBe(true);
  expect(tex.endsWith("\\end{document}\n")).toBe(true);
  expect(body(doc)).toBe(String.raw`
\begin{document}

\begin{center}
  \textbf{\Huge Ada Example} \\
  \small Campinas, SP $|$ (19) 90000-0000 $|$ \href{mailto:ada@example.com}{ada@example.com} \\
  \href{https://www.linkedin.com/in/ada/}{linkedin.com/in/ada} $|$
  \href{https://github.com/ada}{github.com/ada}
\end{center}

\section{Resumo Profissional}
\small{C\# \& .NET developer.}

\section{Formação Acadêmica}
\resumeSubHeadingList
  \resumeSubheading
      {State University}{Campinas, SP}
      {BSc}{08/2019 -- 08/2023}
  \vspace{4pt}
  \resumeSubheading
      {Tech School}{}
      {Technician}{2015 -- 2016}
\resumeSubHeadingListEnd

\section{Habilidades}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{Back-End}{: C\#, .NET} \\
     \textbf{Data}{: SQL}
    }}
 \end{itemize}
 \vspace{-12pt}

\section{Experiência Profissional}
\resumeSubHeadingList

\resumeSubheading
    {Northwind}{01/2024 -- Atual}
    {Developer}{Angular, C\#}
  \resumeSubHeadingList
      \resumeItem{\textbullet\ Built 100\% of it.}
  \resumeSubHeadingListEnd

\resumeSubHeadingListEnd

\section{Projetos}
\resumeSubHeadingList
  \resumeSubheading
      {Tracker}{05/2026}
      {Full-stack app}{Next.js}
      \resumeSubHeadingList
          \resumeItem{\textbullet\ Imports bank data.}
      \resumeSubHeadingListEnd

  \resumeSubheading
      {Site}{}
      {}{}
\resumeSubHeadingListEnd

\section{Certificações}
\resumeSubHeadingList
  \resumeItem{\textbullet\ AWS\_Cert}
\resumeSubHeadingListEnd

\end{document}
`);
});

test("leaves out empty sections, an empty contact line and links LaTeX cannot hold", () => {
  expect(body(empty)).toBe("\n\\begin{document}\n\n\\begin{center}\n  \\textbf{\\Huge Ada Example} \\\\\n\\end{center}\n\n\\end{document}\n");
  const linksOnly = body({ ...empty, links: ["https://ada.example/", "javascript:alert(1)"], skills: [{ name: "", items: ["React", "Node.js"] }] });
  expect(linksOnly).toContain("  \\small \\href{https://ada.example/}{ada.example}\n\\end{center}");
  expect(linksOnly).toContain("    \\small{\\item{\n     React, Node.js\n    }}");
});
