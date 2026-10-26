import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

/** Built web app: next to the bundled CLI (`out/cli` → `out/web`) unless overridden. */
export function webRoot(): string {
  return resolve(process.env.WORK_TRACKER_WEB_ROOT ?? join(__dirname, "..", "web"));
}

/**
 * Serves a file of the built web app. Hashed assets are immutable; the page,
 * service worker and manifest are revalidated so an update is picked up.
 */
export async function serveStatic(root: string, pathname: string): Promise<Response> {
  const notFound = () => new Response("not found", { status: 404 });
  let path: string;
  try { path = decodeURIComponent(pathname); } catch { return notFound(); }
  if (path.includes("\0")) return notFound();
  const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
  if (!file.startsWith(root + sep)) return notFound();
  let body: Buffer;
  try { body = await readFile(file); } catch { return notFound(); }
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
