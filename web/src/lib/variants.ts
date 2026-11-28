import { request, useApi } from "./api"
export type { ResumeVariant, VariantRole, VariantLanguage, VariantStatus, VariantSource, VariantLatex, VariantLatexFile } from "../../../src/variants/types"
import type { ResumeVariant, VariantLatex, VariantLatexFile, VariantRole } from "../../../src/variants/types"

export const roleLabels: Record<VariantRole, string> = { frontend: "Front-End", backend: "Back-End", fullstack: "Full Stack", other: "Other" }
export const roleOrder: VariantRole[] = ["frontend", "backend", "fullstack", "other"]
export const languageLabels = { auto: "Same as the base resume", en: "English", pt: "Portuguese" } as const
export const stackSuggestions = ["React", "Angular", "Vue", "TypeScript", "JavaScript", "Node.js", "C#", ".NET", "Java", "Spring", "Python", "Go", "PostgreSQL", "AWS", "Docker", "Kubernetes"] as const

/** "Back-End · C#, .NET — 1 page", as the saved-resume picker lists it. */
export function variantLabel(variant: Pick<ResumeVariant, "role" | "stacks" | "pdf">) {
  const pages = variant.pdf ? ` — ${variant.pdf.pages} ${variant.pdf.pages === 1 ? "page" : "pages"}` : ""
  return `${roleLabels[variant.role]} · ${variant.stacks.join(", ")}${pages}`
}
/** Variants change through `changed` events on `resume_variants`; see the dependencies in api.ts. */
export function useVariants() {
  return useApi<ResumeVariant[]>("resume-variants")
}
/** Ready variants a job can use, grouped by role in the picker's order. */
export function readyVariants(variants: ResumeVariant[] | undefined) {
  return (Array.isArray(variants) ? variants : []).filter(variant => variant.status === "ready" && !variant.archivedAt && variant.pdf)
    .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))
}
export function variantAction(action: "generate" | "regenerate" | "update" | "archive" | "cancel" | "import", body: Record<string, unknown>) {
  return request<ResumeVariant | { ok: true }>(`resume-variants/${action}`, body)
}
/** The saved resume's page, opened from its card in Resumes. */
export function resumeHref(id: string) {
  return `#/resume?id=${encodeURIComponent(id)}`
}
/** "Tailored for Acme", "Generated" or "Imported PDF". */
export function variantOrigin(variant: Pick<ResumeVariant, "origin" | "source">) {
  if (variant.source) return `Tailored for ${variant.source.company || variant.source.title || "an application"}`
  return variant.origin === "imported" ? "Imported PDF" : "Generated"
}
/** The editable LaTeX files of a saved resume. */
export function readVariantLatex(id: string) {
  return request<VariantLatex>("resume-variants/latex", { id })
}
/** Save edited LaTeX files; the backend compiles them into a new PDF. */
export function saveVariantLatex(id: string, files: VariantLatexFile[]) {
  return request<ResumeVariant>("resume-variants/save-latex", { id, files })
}
