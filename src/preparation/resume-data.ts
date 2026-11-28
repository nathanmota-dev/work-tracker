import { canonicalSkill } from "../ats/vocabulary.ts";

export class PreparationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function parseResumeData(text: string, extension: string): Record<string, unknown> {
  if (extension !== ".json") throw new PreparationError("Choose a .json resume data file.");
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { throw new PreparationError(`Invalid resume data: ${(error as Error).message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PreparationError("Resume data must be an object.");
  const result = value as Record<string, unknown>;
  for (const key of ["education", "work", "projects", "skills", "techStack"]) {
    if (result[key] !== undefined && !Array.isArray(result[key])) throw new PreparationError(`${key} must be an array.`);
  }
  const libraries = /^(shadcn[./]ui|nextauth|three\.js|react-icons|@next\/mdx|styled-components|remixicon|swiperjs|scrollreveal|next-intl|framer(?: motion)?)$/i;
  function normalize(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    for (const [key, entry] of Object.entries(obj)) {
      if (["skills", "techStack"].includes(key) && Array.isArray(entry)) {
        if (!entry.every(item => typeof item === "string")) throw new PreparationError(`${key} must contain technology names.`);
        (obj as Record<string, unknown>)[key] = [...new Set(entry.map(canonicalSkill).filter(item => item && !libraries.test(item)))];
      } else if (Array.isArray(entry)) entry.forEach(normalize);
    }
  }
  normalize(result);
  return result;
}
