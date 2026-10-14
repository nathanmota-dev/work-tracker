import { beforeEach, expect, test, vi } from "vitest";
import { accessSync, constants } from "node:fs";
import { doctor, executableExists } from "./doctor.ts";
vi.mock("../paths.ts", () => ({ paths: { home: "/private" } }));
vi.mock("../mcp/config.ts", () => ({
  mcpServers: () => [
    { name: "linkedin", command: "/local/linkedin" },
    { name: "chrome", command: "chrome-devtools-mcp" },
  ],
}));
beforeEach(() => {
  vi.stubEnv("PATH", "/first:/second");
  vi.mocked(accessSync).mockImplementation((path) => {
    if (path !== "/second/opencode" && path !== "/local/linkedin")
      throw new Error("not executable");
  });
});
test("diagnostic resolves PATH and absolute executable paths with execute permission", () => {
  expect(executableExists("opencode")).toBe(true);
  expect(accessSync).toHaveBeenCalledWith("/first/opencode", constants.X_OK);
  expect(accessSync).toHaveBeenCalledWith("/second/opencode", constants.X_OK);
  expect(executableExists("/local/linkedin")).toBe(true);
  expect(executableExists("missing")).toBe(false);
  vi.stubEnv("PATH", undefined);
  expect(executableExists("missing")).toBe(false);
});
test("doctor reports optional dependency availability without starting any executable", () => {
  expect(doctor()).toEqual({
    node: process.versions.node,
    home: "/private",
    dependencies: [
      { name: "linkedin", command: "/local/linkedin", available: true },
      { name: "chrome", command: "chrome-devtools-mcp", available: false },
      { name: "opencode", command: "opencode", available: true },
      { name: "claude", command: "claude", available: false },
      { name: "claude-code-acp", command: "claude-code-acp", available: false },
      { name: "typst", command: "typst", available: false },
      ...["latexmk", "pdflatex", "xelatex", "lualatex", "pdfinfo", "pdftotext"].map(command => ({ name: command, command, available: false })),
    ],
  });
});
