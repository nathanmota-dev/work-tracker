import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { reviewDrafts } from "./fill-drafts.ts";

const context = {
  resume: "Built the report export of an internal dash-\nboard in React and Node.js.",
  profile: { work: [{ company: "Example", description: "Reduced checkout latency with caching" }], skills: ["PostgreSQL", 3, null] },
  experience: [{ file: "export.md", text: "Migração do serviço de vídeo para filas assíncronas" }],
};
beforeEach(() => { vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(context)); });
const review = (drafted: unknown[], unfilled: unknown[] = [], fields: Record<string, unknown> = {}) => reviewDrafts(fields, unfilled, drafted, "/artifacts/r/fill-context.json");
const draft = (evidence: unknown, extra: Record<string, unknown> = {}) => ({ label: "Tell us about a project", answer: "I built it.", basis: "profile", evidence, ...extra });
const reasons = (entries: unknown[]) => review(entries).unfilled.map(entry => (entry as { reason: string }).reason);

test("a draft is supported only when every quote is in the candidate's evidence", () => {
  expect(review([draft(["report export of an internal dashboard"])]).unfilled).toEqual([
    { label: "Tell us about a project", reason: "ai-draft", answer: "I built it.", evidence: ["report export of an internal dashboard"] },
  ]);
  expect(reasons([
    draft(["Reduced checkout latency", "PostgreSQL"]),
    draft(["migracao do servico de video"]),
    draft(["Reduced checkout latency", "led a team of ten"]),
    draft(["PostgreSQL"]),
    draft(["Reduced checkout latency", "Node"]),
    draft(["checkout latenc"]),
    draft([]),
    draft("Reduced checkout latency with caching"),
  ])).toEqual(["ai-draft", "ai-draft", "ai-draft-unverified", "ai-draft-unverified", "ai-draft-unverified", "ai-draft-unverified", "ai-draft-unverified", "ai-draft-unverified"]);
});

test("general knowledge is labelled and never counted as profile evidence", () => {
  expect(reasons([draft(["Reduced checkout latency"], { basis: "general" })])).toEqual(["ai-draft-general"]);
  expect(fs.readFileSync).not.toHaveBeenCalled();
});

test.each([
  "Pretensão salarial", "What are your compensation expectations?", "Are you legally authorized to work in Brazil?", "Do you need visa support?",
  "Li e aceito a Política de Privacidade", "How many years of experience do you have with React?", "Gênero", "Notice period", "CPF",
])("an answer to a question only the candidate may answer is flagged: %s", label => {
  expect(reasons([draft(["Reduced checkout latency"], { label })])).toEqual(["ai-draft-restricted"]);
});

test("technical wording is not mistaken for a restricted question", () => {
  expect(reasons([
    draft(["Reduced checkout latency"], { label: "How did you debug a race condition?" }),
    draft(["Reduced checkout latency"], { label: "Como você garante que a resposta usa dados autorizados da empresa?" }),
  ])).toEqual(["ai-draft", "ai-draft"]);
});

test("drafted fields leave the filled and pending lists, and self-declared reasons are checked again", () => {
  const result = review(
    [draft(["Reduced checkout latency"], { label: "Why us?" }), { label: "Empty", answer: " " }, { answer: "no label" }, "invalid"],
    [{ label: "Why us?", reason: "no-match" }, { label: "Story", skip: "ai-draft", answer: "Trust me", evidence: [7] }, { label: "Phone", reason: "no-stored-answer" }],
    { "Why us?": "x", email: "ana@example.com" },
  );
  expect(result.fields).toEqual({ email: "ana@example.com" });
  expect(result.unfilled).toEqual([
    { label: "Phone", reason: "no-stored-answer" },
    expect.objectContaining({ label: "Why us?", reason: "ai-draft" }),
    { label: "Empty", reason: "no-evidence" },
    { label: "Story", reason: "ai-draft-unverified", answer: "Trust me", evidence: [] },
  ]);
  expect(review([], [{ reason: "ai-draft" }, { label: "Phone" }], { a: 1 })).toEqual({ fields: { a: 1 }, unfilled: [{ label: "Phone" }] });
});

test("without readable evidence no draft counts as supported", () => {
  const entry = draft(["Reduced checkout latency"], { answer: "a".repeat(6000) });
  const [missing] = reviewDrafts({}, [], [entry]).unfilled as { reason: string; answer: string }[];
  expect(missing).toMatchObject({ reason: "ai-draft-unverified" });
  expect(missing!.answer).toHaveLength(5000);
  vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error("ENOENT"); });
  expect(reasons([draft(["Reduced checkout latency"])])).toEqual(["ai-draft-unverified"]);
});
