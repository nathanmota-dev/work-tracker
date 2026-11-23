import { now } from "../db/index.ts";
import { parseDeadline } from "../deadlines/urgency.ts";
import { ROLE_TYPES } from "./types.ts";
import type { ApplicationFields } from "./types.ts";

export class ApplicationBoardError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}
export type Body = Record<string, unknown>;

export function object(input: unknown): Body {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApplicationBoardError("Expected a JSON object.");
  return input as Body;
}
export function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new ApplicationBoardError("Expected a valid record ID.");
  return value;
}
export function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string")
    throw new ApplicationBoardError("Expected a text value.");
  return value.trim() || null;
}
export function requiredText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (!text) throw new ApplicationBoardError(`${label} is required.`);
  return text;
}
function webUrl(value: unknown, required = false): string | null {
  const text = required ? requiredText(value, "Job link") : optionalText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname)
      throw new Error();
    return url.href;
  } catch {
    throw new ApplicationBoardError("Enter a valid HTTP or HTTPS URL.");
  }
}
export function choice<T extends string>(
  value: unknown,
  choices: Record<T, string>,
  label: string,
): T {
  if (typeof value !== "string" || !Object.hasOwn(choices, value))
    throw new ApplicationBoardError(`Invalid ${label}.`);
  return value as T;
}
function stack(value: unknown): string[] {
  const items = value ?? [];
  if (!Array.isArray(items) || items.some((item) => typeof item !== "string"))
    throw new ApplicationBoardError("Stack must be a list of technologies.");
  return [...new Set(items.map((item: string) => item.trim()).filter(Boolean))];
}
function deadline(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  const date = parseDeadline(text);
  if (!date) throw new ApplicationBoardError("Enter the deadline as a valid date.");
  return date;
}
function appliedAt(value: unknown): string {
  const timestamp = optionalText(value) ?? now();
  if (Number.isNaN(Date.parse(timestamp)))
    throw new ApplicationBoardError("Invalid application date.");
  return new Date(timestamp).toISOString();
}
export function fields(body: Body, partial: boolean): Partial<ApplicationFields> {
  const values: Partial<ApplicationFields> = {};
  const has = (key: string) => !partial || Object.hasOwn(body, key);
  if (has("company_name"))
    values.company_name = requiredText(body.company_name, "Company name");
  if (has("external_url"))
    values.external_url = webUrl(body.external_url, true)!;
  for (const key of ["role_title", "comp", "notes"] as const) {
    if (has(key)) values[key] = optionalText(body[key]);
  }
  if (has("company_url")) values.company_url = webUrl(body.company_url);
  if (has("role_type")) {
    values.role_type =
      body.role_type == null || body.role_type === ""
        ? null
        : choice(body.role_type, ROLE_TYPES, "role type");
  }
  if (has("stack")) values.stack = stack(body.stack);
  if (has("deadline")) values.deadline = deadline(body.deadline);
  if (has("applied_at")) values.applied_at = appliedAt(body.applied_at);
  return values;
}
