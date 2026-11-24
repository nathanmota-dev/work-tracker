import type { ProfileContact } from "../types.ts";

export const EMPTY_CONTACT: ProfileContact = { email: "", phone: "", linkedin: "", github: "", website: "" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LABELED = /^(.*?)\s*\(([^()]+)\)$/;
const PHONE_LABELS = /^(?:mobile|home|work|phone|celular|residencial|comercial|telefone)$/i;
const SITE_LABELS = /^(?:personal|portfolio|portfólio|pessoal|blog|company|empresa|other|outro)$/i;
const PHONE = /^\+?[\d\s().-]{7,}$/;
const STARTS_ENTRY = /^(?:https?:\/\/|www\.|\+?\d[\d\s().-]{6,}|[\w-]+\.[a-z]{2,}\/)/i;

/** `https://` plus the address without spaces or a trailing slash, or "" when it is not a URL. */
export function webAddress(value: string): string {
  const compact = value.replace(/\s+/g, "").replace(/\/+$/, "");
  if (!/^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(compact)) return "";
  return /^https?:\/\//i.test(compact) ? compact : `https://${compact}`;
}
/** A LinkedIn or GitHub profile URL in the form the answer catalog validates, or "". */
export function profileUrl(value: string, host: "linkedin" | "github"): string {
  const pattern = host === "linkedin" ? /linkedin\.com\/in\/([^/?#\s|,;()]+)/i : /github\.com\/([\w-]+)/i;
  const match = pattern.exec(value);
  if (!match) return "";
  return host === "linkedin" ? `https://www.linkedin.com/in/${match[1]}/` : `https://github.com/${match[1]}`;
}

/**
 * Entries of the sidebar's Contact section. A URL that wraps continues on the
 * next lines until its `(Label)`; an email or a phone stands on its own line.
 */
function entries(lines: string[]): { value: string; label: string }[] {
  const found: { value: string; label: string }[] = [];
  let buffer = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // An unlabeled entry ends where an email or a new address starts.
    if (buffer && (EMAIL.test(line) || STARTS_ENTRY.test(line))) { found.push({ value: buffer, label: "" }); buffer = ""; }
    if (EMAIL.test(line)) { found.push({ value: line, label: "email" }); continue; }
    buffer += line.startsWith("(") ? ` ${line}` : line;
    const labeled = LABELED.exec(buffer);
    if (labeled) { found.push({ value: labeled[1]!.trim(), label: labeled[2]!.trim() }); buffer = ""; }
  }
  if (buffer) found.push({ value: buffer, label: "" });
  return found;
}

/** Email, phone and links of the LinkedIn export's Contact section; absent fields are "". */
export function parseContact(lines: string[]): ProfileContact {
  const contact = { ...EMPTY_CONTACT };
  for (const { value, label } of entries(lines)) {
    if (label === "email" || EMAIL.test(value)) contact.email ||= value;
    else if (/linkedin\.com\/in\//i.test(value)) contact.linkedin ||= profileUrl(value, "linkedin");
    else if (/github\.com\//i.test(value)) contact.github ||= profileUrl(value, "github");
    else if (PHONE_LABELS.test(label) || (!label && PHONE.test(value))) contact.phone ||= PHONE.test(value) ? value : "";
    else if (SITE_LABELS.test(label) || !label) contact.website ||= webAddress(value);
  }
  return contact;
}
