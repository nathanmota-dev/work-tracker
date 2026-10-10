import { beforeEach, expect, test, vi } from "vitest";
import { fetchProfile } from "./fetch-profile.ts";
import { loadConfig } from "../paths.ts";
import { callTool } from "../mcp/linkedin.ts";
import { cliSpies } from "../test/doubles.ts";
vi.mock("../paths.ts", () => ({ loadConfig: vi.fn() }));
vi.mock("../mcp/linkedin.ts", () => ({ callTool: vi.fn() }));
beforeEach(() => {
  cliSpies();
  vi.mocked(loadConfig).mockReturnValue({ username: "saved" });
  vi.mocked(callTool).mockReset().mockResolvedValue({ profile: "fixture" });
});
test("explicit username wins; absent username falls back to configuration", async () => {
  await fetchProfile("explicit");
  expect(loadConfig).not.toHaveBeenCalled();
  expect(callTool).toHaveBeenLastCalledWith("get_person_profile", {
    linkedin_username: "explicit",
    sections:
      "experience,education,skills,certifications,projects,honors,languages,posts",
  });
  await fetchProfile();
  expect(callTool).toHaveBeenLastCalledWith(
    "get_person_profile",
    expect.objectContaining({ linkedin_username: "saved" }),
  );
});
test("missing/empty username fails before MCP and tool failures propagate", async () => {
  await expect(fetchProfile("")).rejects.toThrow("Set username");
  vi.mocked(loadConfig).mockReturnValue({});
  await expect(fetchProfile()).rejects.toThrow("Set username");
  expect(callTool).not.toHaveBeenCalled();
  vi.mocked(callTool).mockRejectedValue(new Error("offline"));
  await expect(fetchProfile("explicit")).rejects.toThrow("offline");
});
