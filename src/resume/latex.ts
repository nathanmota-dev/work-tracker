const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_",
  "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}",
};

/** Plain text as LaTeX: special characters escaped, control characters and line breaks turned into spaces. */
export function latexText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[\\&%$#_{}~^]/g, char => SPECIAL[char]!).trim();
}

/** A link target for `\href`, or "" when it is not an http(s) or mailto address that LaTeX can hold. */
export function latexUrl(value: string): string {
  const url = value.trim();
  if (!/^(?:https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(url) || /[\\{}]/.test(url)) return "";
  return url.replace(/[%#]/g, char => `\\${char}`);
}

/** How a link reads on the resume: no protocol, `www.` or trailing slash. */
export function displayUrl(url: string): string {
  return url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

/**
 * A profile date (`YYYY-MM`, `YYYY` or `Present`) as the resume writes it:
 * `MM/YYYY`, `YYYY` or `Atual`; anything else is left out.
 */
export function resumeDate(date: string): string {
  if (date === "Present") return "Atual";
  const month = /^(\d{4})-(\d{2})$/.exec(date);
  if (month) return `${month[2]}/${month[1]}`;
  return /^\d{4}$/.test(date) ? date : "";
}

/** A period such as `08/2019 -- 08/2025`; a missing end shows the start alone. */
export function resumePeriod(start: string, end: string): string {
  return [resumeDate(start), resumeDate(end)].filter(Boolean).join(" -- ");
}
