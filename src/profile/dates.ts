/** A source date as `YYYY-MM`, `YYYY` or `Present`; "" when absent or unreadable. */
export function profileDate(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (/^(?:present|current|now|atual|presente|o momento)$/i.test(text)) return "Present";
  const iso = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}`;
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (slash) return `${slash[2]}-${slash[1]!.padStart(2, "0")}`;
  return /^\d{4}$/.test(text) ? text : "";
}
