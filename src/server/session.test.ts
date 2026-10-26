import { beforeEach, expect, test, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SESSION_COOKIE, requestToken, sessionResponse, sessionToken, trustedOrigin } from "./session.ts";
vi.mock("../paths.ts", () => ({ paths: { home: "/private" } }));
const saved = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => {
  vi.mocked(writeFileSync).mockReturnValue(undefined);
});

test("reuses a saved token and replaces a missing or invalid one with a private file", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(`${saved}\n`);
  expect(sessionToken()).toBe(saved);
  expect(writeFileSync).not.toHaveBeenCalled();
  vi.mocked(readFileSync).mockReturnValue("tampered");
  const replaced = sessionToken();
  expect(replaced).toMatch(/^[0-9a-f-]{36}$/);
  expect(writeFileSync).toHaveBeenCalledWith("/private/session-token", `${replaced}\n`, { mode: 0o600 });
  vi.mocked(existsSync).mockReturnValue(false);
  expect(sessionToken()).not.toBe(replaced);
});

test("reads the token from the query first, then from the session cookie", () => {
  const url = (query = "") => new URL(`http://127.0.0.1:47830/api/jobs${query}`);
  expect(requestToken(url("?token=query"), `${SESSION_COOKIE}=cookie`)).toBe("query");
  expect(requestToken(url(), `theme=dark; ${SESSION_COOKIE}=cookie; other=1`)).toBe("cookie");
  expect(requestToken(url(), "theme=dark")).toBeUndefined();
  expect(requestToken(url(), undefined)).toBeUndefined();
});

test("trusts only this server's host and origin once the port is known", () => {
  expect(trustedOrigin({ host: "evil.example", origin: "http://evil.example" }, undefined)).toBe(true);
  expect(trustedOrigin({ host: "127.0.0.1:47830" }, 47830)).toBe(true);
  expect(trustedOrigin({ host: "localhost:47830", origin: "http://localhost:47830" }, 47830)).toBe(true);
  expect(trustedOrigin({ host: "127.0.0.1:47830", origin: "http://127.0.0.1:47830" }, 47830)).toBe(true);
  expect(trustedOrigin({}, 47830)).toBe(true);
  // DNS rebinding keeps the attacker's host name.
  expect(trustedOrigin({ host: "rebound.example:47830" }, 47830)).toBe(false);
  expect(trustedOrigin({ host: "127.0.0.1:1234" }, 47830)).toBe(false);
  expect(trustedOrigin({ host: "127.0.0.1:47830", origin: "https://evil.example" }, 47830)).toBe(false);
  expect(trustedOrigin({ host: "127.0.0.1:47830", origin: "null" }, 47830)).toBe(false);
});

test("sets a strict, script-proof session cookie only for this app or a direct visit", async () => {
  const req = (site?: string) => new Request("http://127.0.0.1:47830/api/session", site ? { headers: { "sec-fetch-site": site } } : {});
  for (const site of [undefined, "same-origin", "none"]) {
    const response = sessionResponse(req(site), "secret", "1.0.0");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: "1.0.0" });
    expect(response.headers.get("set-cookie")).toBe(`${SESSION_COOKIE}=secret; HttpOnly; SameSite=Strict; Path=/`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  for (const site of ["cross-site", "same-site"]) {
    const response = sessionResponse(req(site), "secret", "1.0.0");
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  }
});
