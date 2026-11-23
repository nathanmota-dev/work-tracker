/** Fixtures shared by the posting guard tests (ported from ai-job-search's tests/test_posting_guard.py). */

/** ASCII smuggling: each character shadowed in the Unicode tag block. */
export const tagSpelled = (text: string) => Array.from(text, ch => String.fromCodePoint(0xe0000 + ch.codePointAt(0)!)).join("");

/** One variation selector per UTF-8 byte (VS1-16, then VS17-256). */
export const selectorSpelled = (text: string) => Array.from(new TextEncoder().encode(text),
  byte => String.fromCodePoint(byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16)).join("");

export const SCOTLAND = "\u{1F3F4}" + tagSpelled("gbsct") + "\u{E007F}";
export const hasTagCharacter = (text: string) => Array.from(text).some(ch => ch.codePointAt(0)! >= 0xe0000 && ch.codePointAt(0)! <= 0xe007f);

export const ENGLISH = "<html><body><h1>Senior Data Engineer</h1>"
  + "<p>We are hiring a data engineer with 5+ years of Python and SQL. "
  + "You will own our pipelines (Airflow, dbt) and work with the analytics team.</p>"
  + "<ul><li>Python, SQL, Airflow</li><li>Fluent English</li></ul>"
  + "<p>Apply via <a href='https://careers.example.com/123'>our careers page</a>.</p>"
  + "</body></html>";
export const DANISH = "Dataingeniør søges til Aarhus\n\n"
  + "Vi søger en erfaren dataingeniør med flair for Python og SQL. "
  + "Du får ansvar for vores pipelines og arbejder tæt sammen med analyseteamet.\n"
  + "Ansøgningsfrist: 2026-11-01. Løn efter kvalifikationer.\n";
