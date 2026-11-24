import { PreparationError } from "../preparation/sources.ts";
import { VARIANT_LANGUAGES, VARIANT_ROLES, type VariantInput, type VariantLanguage, type VariantProfile, type VariantRole } from "./types.ts";

const MAX_STACKS = 8;

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value !== undefined && value !== null && typeof value !== "string") throw new PreparationError(`${label} must be text.`);
  const trimmed = (value ?? "").trim();
  if (!trimmed && required) throw new PreparationError(`Enter the ${label.toLowerCase()}.`);
  if (trimmed.length > max) throw new PreparationError(`${label} must have at most ${max} characters.`);
  return trimmed || null;
}

/** Trimmed, case-insensitively unique stacks; accepts a list or one comma-separated string. */
export function normalizeStacks(value: unknown): string[] {
  const items = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : null;
  if (!items || items.some(item => typeof item !== "string")) throw new PreparationError("Stacks must be a list of names.");
  const seen = new Set<string>();
  const stacks: string[] = [];
  for (const item of items as string[]) {
    const stack = item.trim();
    if (!stack || seen.has(stack.toLowerCase())) continue;
    if (stack.length > 40) throw new PreparationError("Each stack must have at most 40 characters.");
    seen.add(stack.toLowerCase());
    stacks.push(stack);
  }
  if (!stacks.length) throw new PreparationError("Add at least one stack.");
  if (stacks.length > MAX_STACKS) throw new PreparationError(`Add at most ${MAX_STACKS} stacks.`);
  return stacks;
}

function role(value: unknown): VariantRole {
  if (!VARIANT_ROLES.includes(value as VariantRole)) throw new PreparationError("Select a role: Front-End, Back-End, Full Stack or Other.");
  return value as VariantRole;
}

/** The name, role and stacks of a variant. */
export function variantProfile(input: Record<string, unknown>): VariantProfile {
  return { name: text(input.name, "Name", 80, true)!, role: role(input.role), stacks: normalizeStacks(input.stacks) };
}

/** A complete generation request. */
export function variantInput(input: Record<string, unknown>): VariantInput {
  const language = input.language === undefined || input.language === "" ? "auto" : input.language;
  if (!VARIANT_LANGUAGES.includes(language as VariantLanguage)) throw new PreparationError("Select a language: Auto, Portuguese or English.");
  const provider = text(input.provider, "Agent", 80, false);
  if (!provider) throw new PreparationError("Select an agent.");
  return { ...variantProfile(input), focus: text(input.focus, "Focus", 1000, false), language: language as VariantLanguage, provider, model: text(input.model, "Model", 200, false) };
}

/** A variant ID from a request body. */
export function variantId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new PreparationError("Select a saved resume.");
  return value;
}
