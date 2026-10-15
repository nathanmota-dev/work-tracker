import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync, mkdirSync } from "node:fs";
import { spawnOwned, stopOwned } from "../acp/process.ts";
import { processDouble } from "../test/doubles.ts";
import {
  compileLatex,
  dependencyStatus,
  inspectPdf,
  runCommand,
} from "./latex.ts";
vi.mock("../acp/process.ts", () => ({
  spawnOwned: vi.fn(),
  stopOwned: vi.fn(),
}));
vi.mock("../cli/skills.ts", () => ({
  agentEnvironment: () => ({ PATH: "/tools" }),
}));
let p: ReturnType<typeof processDouble>;
beforeEach(() => {
  vi.useFakeTimers();
  p = processDouble();
  vi.mocked(spawnOwned).mockReset().mockReturnValue(p.asChild);
  vi.mocked(stopOwned).mockClear();
  vi.mocked(readFileSync).mockReturnValue(Buffer.from("%PDF-fixture"));
  vi.mocked(mkdirSync).mockReturnValue(undefined);
});
test("passes literal arguments/environment and collects bounded combined output", async () => {
  const promise = runCommand("tool", ["path with spaces"], "/project");
  p.child.stdout.emit("data", "x".repeat(1024 * 1024));
  p.child.stderr.emit("data", "tail");
  p.child.emit("close", 0);
  const output = await promise;
  expect(output.length).toBe(1024 * 1024);
  expect(output.endsWith("tail")).toBe(true);
  expect(spawnOwned).toHaveBeenCalledWith("tool", ["path with spaces"], {
    cwd: "/project",
    env: { PATH: "/tools" },
  });
  expect(vi.getTimerCount()).toBe(0);
});
test.each(["exit", "error", "timeout", "abort"])(
  "rejects %s and clears resources",
  async (kind) => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const promise = runCommand("tool", [], undefined, controller.signal, 100);
    const rejected = expect(promise).rejects.toThrow(
      kind === "exit"
        ? "failed (2)"
        : kind === "error"
          ? "Could not run tool"
          : kind === "timeout"
            ? "timed out"
            : "Cancelled",
    );
    if (kind === "error") p.child.emit("error", new Error("ENOENT"));
    if (kind === "timeout") await vi.advanceTimersByTimeAsync(100);
    if (kind === "abort") controller.abort();
    p.child.emit("close", kind === "exit" ? 2 : 0);
    await rejected;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    if (["timeout", "abort"].includes(kind))
      expect(stopOwned).toHaveBeenCalledWith(p.asChild);
  },
);
test("pre-abort and synchronous launch errors reject without waiting", async () => {
  await expect(
    runCommand("tool", [], undefined, AbortSignal.abort()),
  ).rejects.toThrow();
  expect(spawnOwned).not.toHaveBeenCalled();
  vi.mocked(spawnOwned).mockImplementation(() => {
    throw new Error("spawn failed");
  });
  await expect(runCommand("tool", [])).rejects.toThrow("spawn failed");
  expect(vi.getTimerCount()).toBe(0);
});
function automatic(info = "Pages: 2", text = "resume text", log = "compiled") {
  vi.mocked(spawnOwned).mockImplementation((command) => {
    const next = processDouble();
    queueMicrotask(() => {
      next.child.stdout.emit(
        "data",
        command === "pdfinfo" ? info : command === "pdftotext" ? text : log,
      );
      next.child.emit("close", 0);
    });
    return next.asChild;
  });
}
test("rejects malformed PDF before invoking tools", async () => {
  vi.mocked(readFileSync).mockReturnValue(Buffer.from("invalid"));
  await expect(inspectPdf("/p.pdf")).rejects.toThrow("not a PDF");
  expect(spawnOwned).not.toHaveBeenCalled();
});
test.each([
  ["Pages: 0", "text"],
  ["metadata", "text"],
  ["Pages: 1", "  "],
])("rejects missing pages/text", async (info, text) => {
  automatic(info, text);
  await expect(inspectPdf("/p.pdf")).rejects.toThrow("extractable text");
});
test.each([
  ["pdflatex", "-pdf"],
  ["xelatex", "-xelatex"],
  ["lualatex", "-lualatex"],
] as const)(
  "compiles with %s safely and inspects the result",
  async (engine, flag) => {
    automatic("Pages: 2", "resume text", "Overfull \\hbox");
    const result = await compileLatex("/project", "resume.tex", engine);
    expect(spawnOwned).toHaveBeenCalledWith(
      "latexmk",
      expect.arrayContaining([
        "-norc",
        flag,
        `-${engine}=${engine} -no-shell-escape %O %S`,
        "-outdir=/project/output",
        "resume.tex",
      ]),
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(result.path).toBe("/project/output/resume.pdf");
    expect(result.check).toEqual({
      pages: 2,
      text: "resume text",
      warnings: [expect.stringContaining("overflowing")],
    });
  },
);
test("reports each dependency independently including unavailable commands", async () => {
  automatic();
  const good = await dependencyStatus("xelatex");
  expect(good.map((x) => x.command)).toEqual([
    "latexmk",
    "xelatex",
    "pdfinfo",
    "pdftotext",
  ]);
  expect(good.every((x) => x.available)).toBe(true);
  vi.mocked(spawnOwned).mockImplementation(() => {
    throw new Error("missing");
  });
  expect((await dependencyStatus("pdflatex")).every((x) => !x.available)).toBe(
    true,
  );
});
