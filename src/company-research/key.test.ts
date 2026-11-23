import { expect, test } from "vitest";
import { COMPANY_RESEARCH_TTL_DAYS, companyKey } from "./key.ts";

test("the TTL is 30 days", () => {
  expect(COMPANY_RESEARCH_TTL_DAYS).toBe(30);
});

test.each([
  ["Acme Corp", "acme-corp"],
  ["acme corp ", "acme-corp"],
  ["  ACME   Corp\t", "acme-corp"],
  ["Acme Corp Ltd", "acme-corp-ltd"],
  ["Acme Corp, Inc.", "acme-corp,-inc."],
  ["   ", ""],
])("normalizes %j to %j without touching legal suffixes", (name, key) => {
  expect(companyKey(name)).toBe(key);
});
