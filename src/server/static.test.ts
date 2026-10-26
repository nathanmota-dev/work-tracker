import { beforeEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serveStatic, webRoot } from "./static.ts";
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
const root = "/app/web";
const files: Record<string, string> = {
  "/app/web/index.html": "<html>",
  "/app/web/sw.js": "worker",
  "/app/web/manifest.webmanifest": "{}",
  "/app/web/assets/index-abc.js": "app",
  "/app/web/pdfjs/wasm/openjpeg.wasm": "wasm",
  "/app/web/pdfjs/cmaps/Adobe-GB1-0.bcmap": "map",
  "/app/secret.txt": "secret",
};
beforeEach(() => {
  vi.mocked(readFile).mockImplementation((async (path: string) => {
    if (!(path in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return Buffer.from(files[path]!);
  }) as unknown as typeof readFile);
});

test("serves the page at / and revalidates the page, worker and manifest", async () => {
  for (const [path, type] of [["/", "text/html; charset=utf-8"], ["/index.html", "text/html; charset=utf-8"], ["/sw.js", "text/javascript; charset=utf-8"], ["/manifest.webmanifest", "application/manifest+json"]]) {
    const response = await serveStatic(root, path!);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
  expect(await (await serveStatic(root, "/")).text()).toBe("<html>");
});

test("caches hashed assets forever and types PDF.js resources", async () => {
  const asset = await serveStatic(root, "/assets/index-abc.js");
  expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(await asset.text()).toBe("app");
  expect((await serveStatic(root, "/pdfjs/wasm/openjpeg.wasm")).headers.get("content-type")).toBe("application/wasm");
  expect((await serveStatic(root, "/pdfjs/cmaps/Adobe-GB1-0.bcmap")).headers.get("content-type")).toBe("application/octet-stream");
});

test("never leaves the web folder and answers 404 for missing or invalid paths", async () => {
  for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/%00", "/%E0%A4%A", "/missing.js", "/assets"]) {
    const response = await serveStatic(root, path);
    expect(response.status, path).toBe(404);
  }
  expect(readFile).not.toHaveBeenCalledWith("/app/secret.txt");
});

test("finds the built app next to the bundled CLI unless overridden", () => {
  expect(webRoot()).toBe(resolve(join(__dirname, "..", "web")));
  vi.stubEnv("WORK_TRACKER_WEB_ROOT", "/custom/web");
  expect(webRoot()).toBe("/custom/web");
});
