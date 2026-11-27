import { afterEach, describe, expect, test, vi } from "vitest";
import { importJob } from "./import.ts";

const url = "https://careers.test/jobs/1";
const posting = (title: string) => `<script type="application/ld+json">{"@type":"JobPosting","title":"${title}"}</script>`;
const respond = (body: ConstructorParameters<typeof Response>[0], init: ResponseInit = {}) => {
  const fetch = vi.fn(async () => new Response(body, { headers: { "content-type": "text/html" }, ...init }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};
afterEach(() => vi.unstubAllGlobals());

describe("importJob", () => {
  test("reads the posting of a page with one bounded request", async () => {
    const fetch = respond(posting("Engineer"));
    await expect(importJob({ url: ` ${url} ` })).resolves.toEqual({ fields: { title: "Engineer", source: "careers.test" } });
    expect(fetch).toHaveBeenCalledWith(new URL(url), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  test.each([null, {}, { url: 4 }, { url: "ftp://careers.test" }, { url: "https://a:b@careers.test" }])("refuses %j without fetching", async body => {
    const fetch = respond("");
    await expect(importJob(body)).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([
    ["header", "text/html; charset=iso-8859-1", ""],
    ["meta tag", "text/html", '<meta charset="iso-8859-1">'],
  ])("decodes the charset of the %s", async (_name, type, meta) => {
    respond(Buffer.from(meta + posting("Programação"), "latin1"), { headers: { "content-type": type } });
    await expect(importJob({ url })).resolves.toMatchObject({ fields: { title: "Programação" } });
  });
  test("reads UTF-8 when the declared charset is unknown", async () => {
    respond(posting("Programação"), { headers: { "content-type": "text/html; charset=unknown-set" } });
    await expect(importJob({ url })).resolves.toMatchObject({ fields: { title: "Programação" } });
  });
  test.each([
    ["an error status", "gone", { status: 404 }, "status 404"],
    ["another content type", "%PDF", { headers: { "content-type": "application/pdf" } }, "does not open a web page"],
    ["an oversized page", "a".repeat(3 * 1024 * 1024 + 1), {}, "too large"],
    ["a page without job data", "<h1>Job</h1>", {}, "doesn't publish job data"],
    ["an empty page", null, {}, "doesn't publish job data"],
    ["a list of jobs", posting("One") + posting("Two"), {}, "lists several jobs"],
  ])("explains %s", async (_name, body, init, message) => {
    respond(body, init);
    await expect(importJob({ url })).rejects.toMatchObject({ status: 422, message: expect.stringContaining(message) });
  });
  test("reports a page that cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(importJob({ url })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Could not open this page") });
  });
});
