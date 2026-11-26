import { jobApplyLink } from "../mcp/search.ts";
import { PreparationError } from "./sources.ts";

const PASTE = "Paste the employer's application link in Fill portal, then fill again.";
const BLOCKED: Record<string, string> = {
  closed: "LinkedIn says this posting no longer accepts applications, so it shows no application link. If the employer still takes applications elsewhere, paste that link in Fill portal, then fill again.",
  easy_apply: "This posting uses LinkedIn Easy Apply, which Work Tracker does not fill. Apply on LinkedIn, or paste an external application link in Fill portal.",
  applied: "LinkedIn shows that you already applied to this posting.",
};

/** A LinkedIn job page, whose Apply button leads to the employer's form. */
export function isLinkedInPosting(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(hostname) && pathname.startsWith("/jobs/");
  } catch { return false; }
}

type ApplyRead = { apply?: { type?: string; url?: string }; section_errors?: unknown };

/**
 * The form the portal agent fills. A LinkedIn posting is replaced by the
 * employer's link behind its Apply button; any other link was chosen by the
 * candidate and is used as it is.
 */
export async function resolvePortalUrl(url: string, linkedinJobId: string | null | undefined): Promise<string> {
  if (!isLinkedInPosting(url)) return url;
  if (!linkedinJobId) throw new PreparationError(`This application points to a LinkedIn page. ${PASTE}`);
  let read: ApplyRead;
  try { read = await jobApplyLink(linkedinJobId) as ApplyRead; }
  catch (error) { throw new PreparationError(`Could not read LinkedIn's Apply button (${(error as Error).message}). ${PASTE}`); }
  const type = read.apply?.type ?? "unknown";
  const link = read.apply?.url;
  if (type === "external" && link) {
    try {
      const employer = new URL(link);
      if (["https:", "http:"].includes(employer.protocol)) return employer.href;
    } catch { /* invalid link below */ }
  }
  throw new PreparationError(BLOCKED[type] ?? `LinkedIn did not reveal an application link for this posting. ${PASTE}`);
}
