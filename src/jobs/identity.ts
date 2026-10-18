/** Only known tracking parameters are discarded; unknown parameters can identify jobs. */
const tracking = /^utm_.+/i;
const linkedinTracking = /^(trk|trackingId|refId)$/i;

export function webUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** Retain ports, query identity and SPA routes while ignoring ordinary page anchors. */
export function normalizeLink(value: string | null): string | null {
  const url = webUrl(value);
  if (!url) return null;
  const linkedin = /(^|\.)linkedin\.com$/i.test(url.hostname);
  for (const key of [...url.searchParams.keys()])
    if (tracking.test(key) || (linkedin && linkedinTracking.test(key))) url.searchParams.delete(key);
  url.searchParams.sort();
  const fragment = /^#(?:!?\/|.*[?=])/.test(url.hash) ? url.hash : "";
  return `${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}${fragment}`;
}

/** External LinkedIn job ID, never inferred from the title. */
export function linkedinJobId(value: string | null): string | null {
  const url = webUrl(value);
  if (!url || !/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  return url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)(?:\/|$)/)?.[1]
    ?? url.searchParams.get("currentJobId")?.match(/^\d+$/)?.[0] ?? null;
}
