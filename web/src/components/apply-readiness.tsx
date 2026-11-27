import { Button } from "@/components/ui/button"
import { agentSetupLink, correctionLink, diagnosticBlocks, integrationLabels, type Target, type IntegrationStatus } from "@/lib/integrations"
import { getStartedLink, type StepId } from "@/lib/onboarding"
import { PostingCheck } from "@/components/posting-check"
import type { StoredGate } from "@/lib/gates"
import { undecidedConflicts, useProfileSources } from "@/lib/profile-sources"
export type ApplyAction = "description" | "model" | "review" | "gate"
/** @property [step] Get started step that walks through this correction. */
export type ApplyBlock = { message: string; label: string; href?: string; action?: ApplyAction; step?: StepId }
export type ReadinessInput = {
  live: boolean; busy: boolean; archived: boolean; submitted: boolean; sources: boolean; tools: boolean;
  descriptionDirty: boolean; descriptionMissing: boolean; gateUnconfirmed?: boolean; linkedinNeeded?: boolean; tailored: boolean; approved?: boolean; baseUnconfigured?: boolean; provider?: string; model: string; invalidModel: boolean;
  integrations?: IntegrationStatus
}
export function applyBlocks(input: ReadinessInput, operation: "generate" | "fill"): ApplyBlock[] {
  const blocks: ApplyBlock[] = []
  if (!input.live) blocks.push({ message: "The backend is disconnected.", label: "Check workspace connection", href: "#/settings?section=general" })
  if (input.busy) blocks.push({ message: "An execution is active. Wait for it to finish or cancel it below.", label: "View activity", href: "#/activity" })
  if (input.archived) blocks.push({ message: "This job is archived.", label: "Restore in Jobs", href: "#/jobs" })
  if (input.submitted) blocks.push({ message: "This application has already been submitted.", label: "Open the board", href: "#/applications?view=board" })
  if (!input.provider) blocks.push({ message: "No ACP provider is available.", label: "Configure an agent", href: agentSetupLink() })
  if (input.invalidModel) blocks.push({ message: "The saved model is unavailable for this provider.", label: "Choose a model", action: "model" })
  if (operation === "generate") {
    if (!input.sources) blocks.push({ message: "Choose a valid LaTeX project before generating.", label: "Configure resume sources", href: "#/resume?id=base", step: "resume" })
    if (!input.tools) blocks.push({ message: "Required LaTeX or PDF tools are unavailable.", label: "Check installed tools", href: correctionLink(), step: "resume" })
    if (input.gateUnconfirmed) blocks.push({ message: "This job failed a deal-breaker check. Review the quoted requirement and confirm before preparing.", label: "Review requirements", action: "gate" })
    if (input.descriptionDirty || input.descriptionMissing) blocks.push({ message: input.descriptionDirty ? "Save your description changes before generating." : "This job needs a description.", label: "Edit job description", action: "description" })
  } else if (!input.tailored) blocks.push({ message: "Choose or generate a resume before filling.", label: "Choose a resume", action: "review" })
  if (operation === "fill" && input.baseUnconfigured) blocks.push({ message: "Choose a valid LaTeX project to use the base resume.", label: "Configure resume sources", href: "#/resume?id=base", step: "resume" })
  if (operation === "fill" && input.tailored && input.approved === false) blocks.push({ message: "Approve the displayed document version before filling.", label: "Review document", action: "review" })
  const targets: Target[] = [...(input.provider ? [`acp/${input.provider}` as Target] : []), ...(operation === "fill" ? ["mcp/chrome" as const] : input.linkedinNeeded ? ["mcp/linkedin" as const] : [])]
  for (const target of targets) {
    const entry = input.integrations?.entries.find(entry => entry.target === target)
    if (entry?.executable === false) blocks.push({ message: `${integrationLabels[target]} executable is missing.`, label: `Configure ${integrationLabels[target]}`, href: correctionLink(target) })
    else if (entry?.diagnostic && (!target.startsWith("acp/") || entry.diagnostic.model === input.model)) {
      for (const check of entry.diagnostic.checks.filter(diagnosticBlocks)) blocks.push({ message: `${integrationLabels[target]}: ${check.message}`, label: `Correct ${integrationLabels[target]}`, href: correctionLink(target) })
    }
  }
  return blocks
}
/**
 * A failed requirements check warns with its quotes and needs a confirmation
 * before preparing. It never blocks for good: the user may know something the
 * profile does not record.
 */
export function GateWarning({ gate, confirmed, onConfirm }: { gate?: StoredGate | null; confirmed: boolean; onConfirm: () => void }) {
  if (gate?.verdict !== "fail") return null
  const findings = [...gate.language.findings, ...gate.eligibility.findings].filter(finding => finding.verdict === "fail")
  return <div id="requirements-warning" role="alert" aria-label="Deal-breaker warning" className="space-y-2 rounded-lg border border-destructive/50 p-3">
    <p className="font-medium">Fail: this job failed your deal-breakers.</p>
    <ul className="space-y-1">{findings.map((finding, i) => <li key={i}>{finding.note}{finding.quote && <> <q className="break-words font-mono text-xs">{finding.quote}</q></>}</li>)}</ul>
    {confirmed
      ? <p className="text-muted-foreground">You confirmed preparing this job anyway.</p>
      : <Button variant="outline" size="sm" onClick={onConfirm}>Prepare anyway</Button>}
  </div>
}
/** @property [guard] Stored posting check of the saved description, shown with it. */
/** Undecided profile conflicts warn without blocking: the base resume keeps its value meanwhile. */
export function ProfileConflictsWarning({ count }: { count: number }) {
  if (!count) return null
  return <p role="status">Your profile has {count} undecided {count === 1 ? "conflict" : "conflicts"} between your data file and LinkedIn. <a className="underline" href="#/profile?tab=profile">Decide in Profile</a></p>
}
function ProfileConflicts() {
  const profile = useProfileSources()
  return <ProfileConflictsWarning count={undecidedConflicts(profile.data).length} />
}
type Correct = (action: ApplyAction) => void
/** What blocks one operation, each with the link or action that corrects it. */
export function BlockList({ label, blocks, correct }: { label: string; blocks: ApplyBlock[]; correct: Correct }) {
  if (!blocks.length) return null
  return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">{label} is blocked</p><ul className="mt-2 space-y-2">{blocks.map((block, i) => <li key={i}>{block.message} {block.href ? <a className="underline" href={block.href}>{block.label}</a> : <button className="underline" onClick={() => block.action && correct(block.action)}>{block.label}</button>}{block.step && <> · <a className="underline" href={getStartedLink(block.step)}>Get started guide</a></>}</li>)}</ul></div>
}
/** Warnings about the role itself: undecided profile conflicts, the posting check and the deal-breaker gate. */
export function RoleWarnings({ guard, description, gate, profile = false }: { guard?: unknown; description?: unknown; gate?: { value?: StoredGate | null; confirmed: boolean; confirm: () => void }; profile?: boolean }) {
  return <div className="space-y-3 text-sm empty:hidden">
    {profile && <ProfileConflicts />}
    <PostingCheck guard={guard} description={description} />
    {gate && <GateWarning gate={gate.value} confirmed={gate.confirmed} onConfirm={gate.confirm} />}
  </div>
}
/** Re-test the selected agent and Chrome before filling. */
export function AvailabilityCheck({ testing, error, test }: { testing: boolean; error: string; test: () => void }) {
  return <div className="space-y-2 text-sm">
    <p className="text-xs text-muted-foreground">Test the selected agent and Chrome before filling. LinkedIn uses a separate session when fetching a missing job description. Portal sign-in may still be needed in the browser.</p>
    <Button variant="outline" size="sm" disabled={testing} onClick={test}>{testing ? "Testing availability…" : "Test availability again"}</Button>
    {error && <p role="alert">{error}</p>}
  </div>
}
/** @property [profile] Warn about undecided profile conflicts before generating. */
export function ApplyReadiness({ generate, fill, testing, error, test, correct, guard, description, gate, profile = false }: { generate: ApplyBlock[]; fill: ApplyBlock[]; testing: boolean; error: string; test: () => void; correct: Correct; guard?: unknown; description?: unknown; gate?: { value?: StoredGate | null; confirmed: boolean; confirm: () => void }; profile?: boolean }) {
  return <div className="mt-4 space-y-3 rounded-lg border p-3 text-sm" aria-label="Apply readiness">
    <RoleWarnings guard={guard} description={description} gate={gate} profile={profile} />
    <BlockList label="Generate" blocks={generate} correct={correct} />
    <BlockList label="Fill" blocks={fill} correct={correct} />
    <AvailabilityCheck testing={testing} error={error} test={test} />
  </div>
}
