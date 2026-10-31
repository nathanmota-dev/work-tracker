import { Button } from "@/components/ui/button"
import { correctionLink, diagnosticBlocks, integrationLabels, type Target, type IntegrationStatus } from "@/lib/integrations"
import { getStartedLink, type StepId } from "@/lib/onboarding"
/** @property [step] Get started step that walks through this correction. */
export type ApplyBlock = { message: string; label: string; href?: string; action?: "description" | "model" | "review"; step?: StepId }
export type ReadinessInput = {
  live: boolean; busy: boolean; archived: boolean; submitted: boolean; sources: boolean; tools: boolean;
  descriptionDirty: boolean; descriptionMissing: boolean; linkedinNeeded?: boolean; tailored: boolean; approved?: boolean; provider?: string; model: string; invalidModel: boolean;
  integrations?: IntegrationStatus
}
export function applyBlocks(input: ReadinessInput, operation: "generate" | "fill"): ApplyBlock[] {
  const blocks: ApplyBlock[] = []
  if (!input.live) blocks.push({ message: "The backend is disconnected.", label: "Check workspace connection", href: "#/settings?section=general" })
  if (input.busy) blocks.push({ message: "An execution is active. Wait for it to finish or cancel it below.", label: "View activity", href: "#/activity" })
  if (input.archived) blocks.push({ message: "This job is archived.", label: "Restore in Jobs", href: "#/jobs" })
  if (input.submitted) blocks.push({ message: "This application has already been submitted.", label: "Open the board", href: "#/applications?view=board" })
  if (!input.provider) blocks.push({ message: "No ACP provider is available.", label: "Configure an agent", href: correctionLink(), step: "connect" })
  if (input.invalidModel) blocks.push({ message: "The saved model is unavailable for this provider.", label: "Choose a model", action: "model" })
  if (operation === "generate") {
    if (!input.sources) blocks.push({ message: "Choose a valid LaTeX project before generating.", label: "Configure resume sources", href: "#/profile?tab=resume", step: "resume" })
    if (!input.tools) blocks.push({ message: "Required LaTeX or PDF tools are unavailable.", label: "Check installed tools", href: correctionLink(), step: "resume" })
    if (input.descriptionDirty || input.descriptionMissing) blocks.push({ message: input.descriptionDirty ? "Save your description changes before generating." : "This job needs a description.", label: "Edit job description", action: "description" })
  } else if (!input.tailored) blocks.push({ message: "Generate and review a validated PDF before filling.", label: "Configure resume sources", href: "#/profile?tab=resume" })
  if (operation === "fill" && input.tailored && input.approved === false) blocks.push({ message: "Approve the displayed document version before filling.", label: "Review document", action: "review" })
  const targets: Target[] = [...(input.provider ? [`acp/${input.provider}` as Target] : []), ...(operation === "fill" ? ["mcp/chrome" as const] : input.linkedinNeeded ? ["mcp/linkedin" as const] : [])]
  for (const target of targets) {
    const entry = input.integrations?.entries.find(entry => entry.target === target)
    if (entry?.executable === false) blocks.push({ message: `${integrationLabels[target]} executable is missing.`, label: `Configure ${integrationLabels[target]}`, href: correctionLink(target), step: "connect" })
    else if (entry?.diagnostic && (!target.startsWith("acp/") || entry.diagnostic.model === input.model)) {
      for (const check of entry.diagnostic.checks.filter(diagnosticBlocks)) blocks.push({ message: `${integrationLabels[target]}: ${check.message}`, label: `Correct ${integrationLabels[target]}`, href: correctionLink(target), step: "connect" })
    }
  }
  return blocks
}
export function ApplyReadiness({ generate, fill, testing, error, test, correct }: { generate: ApplyBlock[]; fill: ApplyBlock[]; testing: boolean; error: string; test: () => void; correct: (action: "description" | "model" | "review") => void }) {
  return <div className="mt-4 space-y-3 rounded-lg border p-3 text-sm" aria-label="Apply readiness">
    {([ ["Generate", generate], ["Fill", fill] ] as const).map(([label, blocks]) => blocks.length > 0 && <div key={label}><p className="font-medium">{label} is blocked</p><ul className="mt-2 space-y-2">{blocks.map((block, i) => <li key={i}>{block.message} {block.href ? <a className="underline" href={block.href}>{block.label}</a> : <button className="underline" onClick={() => block.action && correct(block.action)}>{block.label}</button>}{block.step && <> · <a className="underline" href={getStartedLink(block.step)}>Get started guide</a></>}</li>)}</ul></div>)}
    <p>Test the selected agent and Chrome before filling. LinkedIn uses a separate session when fetching a missing job description. Portal sign-in may still be needed in the browser.</p>
    <Button variant="outline" size="sm" disabled={testing} onClick={test}>{testing ? "Testing availability…" : "Test availability again"}</Button>
    {error && <p role="alert">{error}</p>}
  </div>
}
