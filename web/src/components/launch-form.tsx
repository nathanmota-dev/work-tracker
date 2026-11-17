import type React from "react"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { EffortSlider } from "@/components/ui/effort-slider"
import { Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, controlClass } from "@/components/workspace-ui"
import {
  skills,
  cancelAgent,
  clearAgent,
  type Providers,
  type useAgent,
} from "@/lib/agent"

const labels: Record<string, string> = {
  query: "Role, keywords or job URL",
  location: "Location",
  jobIds: "Saved job IDs",
  username: "LinkedIn username",
  company: "Target company",
  url: "Application URL",
}
export type AgentSelection = {
  selectedProvider?: Providers["providers"][number]
  effectiveModel: string
  effectiveEffort: string
  onProvider: (provider: string) => void
  onModel: (model: string) => void
  onEffort: (effort: string) => void
}
export function AgentSelectors({ providers, selectedProvider, effectiveModel, effectiveEffort, disabled, onProvider, onModel, onEffort }: AgentSelection & {
  providers: Providers["providers"]
  disabled: boolean
}) {
  return (
    <>
      <Field label="Agent">
        <SelectControl
          className={controlClass}
          value={selectedProvider?.id ?? ""}
          disabled={disabled}
          onChange={(e) => onProvider(e.target.value)}
        >
          {providers.map((p) => (
            <option value={p.id} key={p.id}>
              {p.displayName}
            </option>
          ))}
        </SelectControl>
      </Field>
      <Field label="Model">
        <SelectControl
          className={controlClass}
          value={effectiveModel}
          disabled={disabled}
          onChange={(e) => onModel(e.target.value)}
        >
          <option value="">Provider default</option>
          {selectedProvider?.models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </SelectControl>
      </Field>
      {!!selectedProvider?.efforts?.length && <EffortSlider
        label="Effort"
        levels={selectedProvider.efforts}
        value={effectiveEffort}
        disabled={disabled}
        onChange={onEffort}
      />}
    </>
  )
}

export function SkillFields({ fields, skill, params, setParams, username, disabled }: {
  fields: readonly string[]
  skill: string
  params: Record<string, string>
  setParams: React.Dispatch<React.SetStateAction<Record<string, string>>>
  username: string
  disabled: boolean
}) {
  return (
    <>
      {fields.map((key) => (
        <Field key={key} label={labels[key]}>
          <Input
            value={
              params[key] ??
              (key === "username" ? username : "")
            }
            disabled={disabled}
            onChange={(e) =>
              setParams((p) => ({ ...p, [key]: e.target.value }))
            }
            required={
              ["query", "jobIds"].includes(key) &&
              skill !== "portal-filler"
            }
          />
        </Field>
      ))}
    </>
  )
}

export function WorkspaceActions({ agent, onError }: { agent: ReturnType<typeof useAgent>; onError: (message: string) => void }) {
  return (
    <div className="flex gap-2">
      {agent.running || agent.status === "Waiting for sign-in" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void cancelAgent().catch((e) => onError(e.message))
          }
        >
          <Square />
          Cancel
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={!agent.messages.length}
          onClick={clearAgent}
        >
          Clear
        </Button>
      )}
    </div>
  )
}

export const launchSkills = skills.filter(s => s.id !== "resume-tailor")

export function SkillPicker({ skill, description, disabled, onSkill }: {
  skill: string
  description: string
  disabled: boolean
  onSkill: (skill: string) => void
}) {
  return (
    <>
      <Field label="Skill">
        <SelectControl
          className={controlClass}
          value={skill}
          disabled={disabled}
          onChange={(e) => onSkill(e.target.value)}
        >
          {launchSkills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectControl>
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </>
  )
}

export function RunFooter({ extra, onExtra, running, canRun, live, waitingForSignIn }: {
  extra: string
  onExtra: (extra: string) => void
  running: boolean
  canRun: boolean
  live: boolean
  waitingForSignIn: boolean
}) {
  return (
    <>
      <Field label="Additional context">
        <Textarea
          className={`${controlClass} h-28 resize-y py-2`}
          placeholder="What should the agent know?"
          disabled={running}
          value={extra}
          onChange={(e) => onExtra(e.target.value)}
        />
      </Field>
      <Button
        className="w-full"
        disabled={running || !canRun}
      >
        <Play className="size-4" />
        {waitingForSignIn ? "Retry after sign-in" : "Run agent"}
      </Button>
      {!live && (
        <p className="text-xs text-muted-foreground">
          Waiting for the live connection before starting a run.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Include everything the agent needs before starting. You can
        adjust context in your next run.
      </p>
    </>
  )
}
