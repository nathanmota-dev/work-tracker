import { JobError } from "./store.ts";

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const HEADERS = { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; WorkTracker)" };
const MANUAL = "Fill in the fields manually.";

async function boundedBody(response: Response): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new JobError(`This page is too large to import. ${MANUAL}`, 422);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The charset of the header, then of the page's own meta tag; UTF-8 when neither is usable. */
function decode(body: Buffer, contentType: string): string {
  const declared = /charset\s*=\s*["']?([\w-]+)/i;
  const charset = declared.exec(contentType)?.[1] ?? declared.exec(body.subarray(0, 2048).toString("latin1"))?.[1];
  try { return new TextDecoder(charset ?? "utf-8").decode(body); }
  catch { return new TextDecoder().decode(body); }
}

/** Download the job page the user pasted: one GET, bounded in time and size, without cookies or sign-in. */
export async function fetchJobPage(url: URL): Promise<string> {
  try {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const contentType = response.headers.get("content-type") ?? "";
    const refusal = !response.ok ? `The page answered with status ${response.status}. It may require sign-in or no longer exist.`
      : contentType && !/html/i.test(contentType) ? "This link does not open a web page." : "";
    if (refusal) {
      await response.body?.cancel();
      throw new JobError(`${refusal} ${MANUAL}`, 422);
    }
    return decode(await boundedBody(response), contentType);
  } catch (error) {
    if (error instanceof JobError) throw error;
    throw new JobError(`Could not open this page. Check the link and your connection, or ${MANUAL.toLowerCase()}`, 502);
  }
}
