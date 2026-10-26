import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../paths.ts";

export const SESSION_COOKIE = "wt_session";
const TOKEN_PATTERN = /^[0-9a-f-]{36}$/;

/**
 * Token shared by every backend start, so the installed web app keeps its
 * session cookie across automatic restarts.
 */
export function sessionToken(): string {
  const file = join(paths.home, "session-token");
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();
    if (TOKEN_PATTERN.test(saved)) return saved;
  }
  const token = randomUUID();
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

function cookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

/** The query token (CLI, scripts) or the session cookie (web app). */
export function requestToken(url: URL, cookieHeader: string | null | undefined): string | undefined {
  return url.searchParams.get("token") ?? cookie(cookieHeader, SESSION_COOKIE);
}

/**
 * Rejects other sites and DNS rebinding: a present Host must name this
 * server, and a present Origin must be the origin it serves.
 */
export function trustedOrigin(headers: { host?: string | null; origin?: string | null }, port: number | undefined): boolean {
  if (port === undefined) return true;
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (headers.host && !hosts.includes(headers.host)) return false;
  return !headers.origin || hosts.some(host => headers.origin === `http://${host}`);
}

/** Sets the session cookie for the web app; browsers refuse it to other sites. */
export function sessionResponse(req: Request, token: string, version: string): Response {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return new Response("forbidden", { status: 403 });
  return Response.json({ ok: true, version }, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
    },
  });
}
