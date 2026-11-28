import { randomUUID } from "node:crypto";
import { sourceScores } from "../ats/store.ts";
import { db } from "../db/index.ts";
import { PreparationError, snapshotSources, type SourcesSnapshot } from "../preparation/sources.ts";
import type { ExecutionSlot, PreparationAgent } from "../preparation/executor.ts";
import { archiveVariant, insertVariant, interruptStaleVariants, listVariants, updateVariant, variantRecord } from "./store.ts";
import { variantId, variantInput, variantProfile } from "./validation.ts";
import { generateVariant } from "./generate.ts";
import { saveApprovedTailoredResumes } from "./promote.ts";
import { readVariantLatex, saveVariantLatex } from "./source.ts";
import type { ResumeVariant, VariantLatex, VariantPhase } from "./types.ts";

/** The current sources' version; null when they are not configured or unreadable. */
export function currentSourceVersion(): string | null {
  try { return snapshotSources().version; } catch { return null; }
}

/**
 * Generates and manages resume variants. Generation shares the ExecutionSlot of
 * Apply, the batch queue and Launch, so only one agent execution runs at a time.
 */
export class VariantService {
  private unsubscribe?: () => void;
  constructor(private acp: PreparationAgent, private broadcast: (event: unknown) => void, private slot: ExecutionSlot) {
    interruptStaleVariants();
    saveApprovedTailoredResumes();
    this.unsubscribe = acp.subscribe?.(event => {
      const id = this.slot.activeFor("variant");
      if (!event.runId || id !== event.runId) return;
      const variant = variantRecord(id);
      updateVariant(id, { events_json: JSON.stringify([...variant.events, event].slice(-500)) });
      this.changed(id);
    });
  }
  private changed(id?: string): void { this.broadcast({ type: "changed", table: "resume_variants", variantId: id }); }
  /** With each tailored resume's score against the job it was tailored for. */
  list(input: { includeArchived?: boolean } = {}): ResumeVariant[] {
    const version = currentSourceVersion();
    const variants = listVariants({ includeArchived: input.includeArchived, currentVersion: version });
    const scores = sourceScores(db(), variants.flatMap(variant => variant.source ? [{ variantId: variant.id, jobId: variant.source.jobId }] : []), () => version);
    return variants.map(variant => ({ ...variant, match: scores.get(variant.id) ?? null }));
  }
  get(id: string): ResumeVariant { return variantRecord(id, currentSourceVersion()); }
  /** `sources` lets a caller generate from a recorded snapshot instead of the current sources. */
  generate(input: Record<string, unknown>, sources?: SourcesSnapshot): ResumeVariant {
    this.slot.assertIdle();
    const request = variantInput(input);
    const snapshot = sources ?? snapshotSources();
    const id = randomUUID();
    insertVariant(id, request, "generated");
    return this.start(id, snapshot);
  }
  /** Generate again from the current sources; the previous PDF stays for documents that used it. */
  regenerate(input: Record<string, unknown>, sources?: SourcesSnapshot): ResumeVariant {
    this.slot.assertIdle();
    const variant = variantRecord(variantId(input.id));
    if (variant.origin === "imported") throw new PreparationError("An imported resume cannot be regenerated. Import the new PDF instead.", 409);
    if (variant.source) throw new PreparationError("This resume was tailored for an application. Tailor it again in Apply.", 409);
    if (variant.archivedAt) throw new PreparationError("Restore this saved resume before regenerating it.", 409);
    const provider = typeof input.provider === "string" && input.provider ? input.provider : variant.provider;
    if (!provider) throw new PreparationError("Select an agent.");
    const model = typeof input.model === "string" ? input.model || null : variant.model;
    const snapshot = sources ?? snapshotSources();
    updateVariant(variant.id, { status: "generating", phase: "preparing", provider, model, error: null, events_json: "[]" });
    return this.start(variant.id, snapshot);
  }
  private start(id: string, snapshot: SourcesSnapshot): ResumeVariant {
    const phase = (value: VariantPhase) => { updateVariant(id, { phase: value }); this.changed(id); };
    this.slot.start(id, "variant", async signal => {
      const done = await generateVariant(id, snapshot, signal, { phase, agent: (manifestPath, extra) => this.agent(id, manifestPath, extra, signal) });
      if (done) this.broadcast({ type: "changed", table: "activity_log" });
    }, (error, cancelled) => this.fail(id, error, cancelled), () => this.changed(id));
    this.changed(id);
    return this.get(id);
  }
  private async agent(id: string, manifestPath: string, extra: string, signal: AbortSignal): Promise<boolean> {
    const variant = variantRecord(id);
    if (await this.slot.runAgent(variant.provider!, variant.model, "resume-tailor", { runId: id, manifestPath, extra }, signal)) return true;
    updateVariant(id, { status: "waiting_for_sign_in" });
    this.changed(id);
    return false;
  }
  private fail(id: string, error: unknown, cancelled: boolean): void {
    updateVariant(id, { status: cancelled ? "cancelled" : "failed", error: cancelled ? null : (error instanceof Error ? error.message : String(error)).slice(-24000) });
    this.changed(id);
  }
  async cancel(input: Record<string, unknown>): Promise<void> {
    const id = variantId(input.id);
    if (this.slot.activeFor("variant") !== id) {
      const variant = variantRecord(id);
      if (variant.status !== "waiting_for_sign_in" || this.slot.isBusy) throw new PreparationError("This generation is not active.", 409);
      this.acp.cancel();
      updateVariant(id, { status: "cancelled", error: null });
      this.changed(id);
      return;
    }
    await this.slot.cancel();
  }
  /** Rename or re-tag a variant without generating it again. */
  update(input: Record<string, unknown>): ResumeVariant {
    const id = variantId(input.id);
    variantRecord(id);
    const profile = variantProfile(input);
    updateVariant(id, { name: profile.name, role: profile.role, stacks_json: JSON.stringify(profile.stacks) });
    this.changed(id);
    return this.get(id);
  }
  /** The editable LaTeX files of a saved resume. */
  latex(input: Record<string, unknown>): VariantLatex { return readVariantLatex(variantId(input.id)); }
  /** Save edited LaTeX files and compile them into a new PDF. */
  async saveLatex(input: Record<string, unknown>): Promise<ResumeVariant> {
    const id = variantId(input.id);
    try { return await saveVariantLatex(id, input.files); }
    finally { this.changed(id); this.broadcast({ type: "changed", table: "activity_log" }); }
  }
  archive(input: Record<string, unknown>): ResumeVariant {
    const id = variantId(input.id);
    if (variantRecord(id).status === "generating") throw new PreparationError("Cancel this generation before archiving it.", 409);
    archiveVariant(id);
    this.changed(id);
    return this.get(id);
  }
  close(): void { this.unsubscribe?.(); }
}
