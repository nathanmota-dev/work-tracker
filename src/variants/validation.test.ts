import { expect, test } from "vitest";
import { normalizeStacks, variantId, variantInput, variantProfile } from "./validation.ts";

const valid = { name: "  Back-End · C#, .NET ", role: "backend", stacks: [" C# ", ".NET", "c#"], provider: "opencode" };

test("normalizes a generation request", () => {
  expect(variantInput(valid)).toEqual({ name: "Back-End · C#, .NET", role: "backend", stacks: ["C#", ".NET"], focus: null, language: "auto", provider: "opencode", model: null });
  expect(variantInput({ ...valid, focus: " APIs ", language: "pt", model: "large" })).toMatchObject({ focus: "APIs", language: "pt", model: "large" });
  expect(variantProfile({ ...valid, stacks: "React, ,TypeScript" }).stacks).toEqual(["React", "TypeScript"]);
});

test.each([
  [{ name: "" }, "Enter the name."],
  [{ name: "x".repeat(81) }, "Name must have at most 80 characters."],
  [{ name: 3 }, "Name must be text."],
  [{ role: "data" }, "Select a role"],
  [{ stacks: [] }, "Add at least one stack."],
  [{ stacks: [1] }, "Stacks must be a list of names."],
  [{ stacks: Array.from({ length: 9 }, (_, i) => `S${i}`) }, "Add at most 8 stacks."],
  [{ stacks: ["x".repeat(41)] }, "Each stack must have at most 40 characters."],
  [{ focus: "x".repeat(1001) }, "Focus must have at most 1000 characters."],
  [{ language: "es" }, "Select a language"],
  [{ provider: "" }, "Select an agent."],
])("rejects %o", (change, message) => {
  expect(() => variantInput({ ...valid, ...change })).toThrow(message);
});

test("accepts only variant IDs", () => {
  expect(variantId("123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
  for (const value of ["", "../x", 7, undefined]) expect(() => variantId(value)).toThrow("Select a saved resume.");
  expect(() => normalizeStacks(null)).toThrow("list of names");
});
