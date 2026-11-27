import { expect, it } from "vitest"
import { applicationSteps, type StepInput } from "./application-steps"

const input = (patch: Partial<StepInput> = {}): StepInput => ({
  description: true,
  resume: false,
  filled: false,
  submitted: false,
  generate: [],
  fill: [],
  ...patch,
})
const states = (patch?: Partial<StepInput>) => applicationSteps(input(patch)).map((step) => step.state)

it("derives the current step from the furthest milestone", () => {
  expect(states({ description: false })).toEqual(["current", "upcoming", "upcoming", "upcoming"])
  expect(states()).toEqual(["done", "current", "upcoming", "upcoming"])
  expect(states({ resume: true })).toEqual(["done", "done", "current", "upcoming"])
  expect(states({ resume: true, filled: true })).toEqual(["done", "done", "done", "current"])
  // A submitted manual application completes every earlier step.
  expect(states({ description: false, submitted: true })).toEqual(["done", "done", "done", "done"])
})

it("reports readiness blocks only on the current step", () => {
  const description = { message: "This job needs a description.", label: "Edit job description", action: "description" as const }
  const offline = { message: "The backend is disconnected.", label: "Check workspace connection", href: "#/settings" }
  const steps = applicationSteps(input({ description: false, generate: [description, offline], fill: [offline] }))
  expect(steps.map((step) => step.state)).toEqual(["blocked", "upcoming", "upcoming", "upcoming"])
  expect(steps[0]!.blocks).toEqual([description])
  expect(steps[2]!.blocks).toEqual([])
  const resume = applicationSteps(input({ generate: [offline] }))
  expect(resume[1]).toMatchObject({ state: "blocked", blocks: [offline] })
  const fill = applicationSteps(input({ resume: true, fill: [offline] }))
  expect(fill[2]).toMatchObject({ state: "blocked", blocks: [offline] })
})
