import { PreparationError } from "./sources.ts";
import { runOptions, updateRun } from "./store.ts";
import { SAVED_RESUME, type PreparationRun } from "./types.ts";

export type FillAgent = { provider: string; model: string | null };

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * The agent that fills the portal for this execution. A tailored resume is
 * filled by the agent that generated it, unless the request selects another.
 * A saved resume ran no agent, so the request (or a previous fill of the same
 * execution) must name one. The choice is kept so a retry reuses it.
 */
export function fillAgent(run: Pick<PreparationRun, "id" | "provider" | "model">, input: Record<string, unknown>): FillAgent {
  const options = runOptions(run.id);
  const requested = text(input.provider);
  const provider = requested ?? text(options.fillProvider) ?? (run.provider === SAVED_RESUME ? null : run.provider);
  if (!provider) throw new PreparationError("Select an agent to fill the portal.");
  const model = requested ? text(input.model) : text(options.fillModel) ?? (provider === run.provider ? run.model : null);
  updateRun(run.id, { options_json: JSON.stringify({ ...options, fillProvider: provider, fillModel: model }) });
  return { provider, model };
}
