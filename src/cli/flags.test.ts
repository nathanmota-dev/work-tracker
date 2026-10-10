import { beforeEach, expect, test } from "vitest";
import { int, parseFlags, reqStr, str } from "./flags.ts";
import { cliSpies } from "../test/doubles.ts";
let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  output = cliSpies();
});
test("flags allow positionals, booleans, negative values and last repeated value wins", () => {
  expect(
    parseFlags([
      "add",
      "--name",
      "Synthetic Person",
      "--apply",
      "--cost",
      "-1",
      "extra",
      "--name",
      "Updated",
      "--json",
    ]),
  ).toEqual({
    positionals: ["add", "extra"],
    flags: { name: "Updated", apply: true, cost: "-1", json: true },
  });
  expect(parseFlags([])).toEqual({ positionals: [], flags: {} });
});
test("typed accessors ignore booleans, parse integer strings and required flags report missing values", () => {
  expect(str({ a: true }, "a")).toBeUndefined();
  expect(str({ a: "" }, "a")).toBe("");
  expect(int({ a: "-2" }, "a")).toBe(-2);
  expect(int({ a: "4.5" }, "a")).toBe(4);
  expect(int({ a: "4tail" }, "a")).toBe(4);
  expect(int({ a: true }, "a")).toBeUndefined();
  expect(int({ a: "invalid" }, "a")).toBeUndefined();
  expect(int({}, "a")).toBeUndefined();
  expect(reqStr({ a: "value" }, "a")).toBe("value");
  expect(() => reqStr({ a: true }, "a")).toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith("error: missing required --a");
});
