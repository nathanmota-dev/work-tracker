import { expect, test } from "vitest";
import { CompanyResearchError, MAX_NOTES, optionalText, parseSources, readSources } from "./sources.ts";

test("keeps known categories with normalized URLs and trimmed notes", () => {
  expect(parseSources({
    website: { url: " https://Example.com/about ", notes: " Mission " },
    media: { url: "http://example.com/news" },
  })).toEqual({
    website: { url: "https://example.com/about", notes: "Mission" },
    media: { url: "http://example.com/news", notes: null },
  });
});

test.each([
  [null, "sources must be an object"],
  [[], "sources must be an object"],
  [{}, "at least one source"],
  [{ blog: { url: "https://example.com" } }, 'unknown source category "blog"'],
  [{ website: "https://example.com" }, "sources.website must be an object"],
  [{ website: { notes: "no url" } }, "sources.website.url must be an http or https URL"],
  [{ website: { url: "ftp://example.com/file" } }, "sources.website.url"],
  [{ website: { url: "javascript:alert(1)" } }, "sources.website.url"],
  [{ reviews: { url: "https://user:secret@example.com/reviews" } }, "without credentials"],
  [{ linkedin: { url: "https://token@example.com/" } }, "without credentials"],
  [{ media: { url: "not a url" } }, "sources.media.url"],
  [{ media: { url: "https://example.com", notes: 42 } }, "sources.media.notes must be text"],
  [{ media: { url: "https://example.com", notes: "x".repeat(MAX_NOTES + 1) } }, `longer than ${MAX_NOTES}`],
])("rejects invalid sources %j", (raw, message) => {
  expect(() => parseSources(raw)).toThrow(CompanyResearchError);
  expect(() => parseSources(raw)).toThrow(message);
});

test("optional text is trimmed, empty becomes null and the limit is configurable", () => {
  expect(optionalText(undefined, "note")).toBeNull();
  expect(optionalText(null, "note")).toBeNull();
  expect(optionalText("  ", "note")).toBeNull();
  expect(optionalText(" ok ", "note", 2)).toBe("ok");
  expect(() => optionalText("abc", "note", 2)).toThrow("note is longer than 2 characters");
});

test("reads stored sources and treats a damaged column as empty", () => {
  expect(readSources('{"website":{"url":"https://example.com/","notes":null}}')).toEqual({ website: { url: "https://example.com/", notes: null } });
  expect(readSources("[1]")).toEqual({});
  expect(readSources("{broken")).toEqual({});
});
