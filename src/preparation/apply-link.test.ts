import { beforeEach, expect, test, vi } from "vitest";
import { jobApplyLink } from "../mcp/search.ts";
import { isLinkedInPosting, resolvePortalUrl } from "./apply-link.ts";
vi.mock("../mcp/search.ts", () => ({ jobApplyLink: vi.fn() }));

const POSTING = "https://www.linkedin.com/jobs/view/4493461039/";
beforeEach(() => { vi.mocked(jobApplyLink).mockReset(); });

test("only LinkedIn job pages count as postings", () => {
  expect(isLinkedInPosting(POSTING)).toBe(true);
  expect(isLinkedInPosting("https://br.linkedin.com/jobs/view/123")).toBe(true);
  expect(isLinkedInPosting("https://www.linkedin.com/in/someone")).toBe(false);
  expect(isLinkedInPosting("https://tally.so/r/QoRLkA")).toBe(false);
  expect(isLinkedInPosting("not a url")).toBe(false);
});

test("a link the candidate chose is used without asking LinkedIn", async () => {
  await expect(resolvePortalUrl("https://tally.so/r/QoRLkA?utm_source=linkedin", "4493461039")).resolves.toBe("https://tally.so/r/QoRLkA?utm_source=linkedin");
  expect(jobApplyLink).not.toHaveBeenCalled();
});

test("a LinkedIn posting is replaced by the employer's link behind Apply", async () => {
  vi.mocked(jobApplyLink).mockResolvedValue({ url: POSTING, apply: { type: "external", url: "https://boards.greenhouse.io/acme/jobs/1" } });
  await expect(resolvePortalUrl(POSTING, "4493461039")).resolves.toBe("https://boards.greenhouse.io/acme/jobs/1");
  expect(jobApplyLink).toHaveBeenCalledWith("4493461039");
});

test.each([
  [{ apply: { type: "closed" } }, "no longer accepts applications"],
  [{ apply: { type: "easy_apply" } }, "Easy Apply"],
  [{ apply: { type: "applied" } }, "already applied"],
  [{ apply: { type: "external" }, section_errors: {} }, "did not reveal an application link"],
  [{ apply: { type: "external", url: "javascript:alert(1)" } }, "did not reveal an application link"],
  [{ section_errors: { apply: {} } }, "did not reveal an application link"],
])("a posting without an employer link asks for one: %j", async (read, message) => {
  vi.mocked(jobApplyLink).mockResolvedValue(read);
  await expect(resolvePortalUrl(POSTING, "4493461039")).rejects.toThrow(message);
});

test("an unreadable or unlinked posting asks for the link", async () => {
  vi.mocked(jobApplyLink).mockRejectedValue(new Error("LinkedIn MCP unavailable"));
  await expect(resolvePortalUrl(POSTING, "4493461039")).rejects.toThrow("Could not read LinkedIn's Apply button (LinkedIn MCP unavailable). Paste the employer's application link");
  await expect(resolvePortalUrl(POSTING, null)).rejects.toThrow("points to a LinkedIn page");
});
