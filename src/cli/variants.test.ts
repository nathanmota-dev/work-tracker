import { beforeEach, expect, test, vi } from "vitest";
import { cliSpies } from "../test/doubles.ts";
import { listVariants } from "../variants/store.ts";
import { currentSourceVersion } from "../variants/service.ts";
import { variantCmd } from "./variants.ts";

vi.mock("../variants/store.ts", () => ({ listVariants: vi.fn() }));
vi.mock("../variants/service.ts", () => ({ currentSourceVersion: vi.fn(() => "v2") }));

let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  output = cliSpies();
  vi.mocked(listVariants).mockReturnValue([{ id: "a", name: "Back-End · C#", stale: true, events: [{ type: "acp-update" }] }] as never);
});

test("lists the saved resumes as JSON without their agent events", () => {
  variantCmd("list", {});
  expect(listVariants).toHaveBeenCalledWith({ includeArchived: false, currentVersion: "v2" });
  expect(JSON.parse(String(output.log.mock.calls.at(-1)![0]))).toEqual([{ id: "a", name: "Back-End · C#", stale: true }]);
  variantCmd("list", { archived: true });
  expect(listVariants).toHaveBeenLastCalledWith({ includeArchived: true, currentVersion: "v2" });
  expect(currentSourceVersion).toHaveBeenCalled();
});

test("rejects an unknown subcommand", () => {
  expect(() => variantCmd("delete", {})).toThrow();
  expect(output.error).toHaveBeenCalledWith("error: unknown variant subcommand: delete (use list)");
});
