import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { DealBreakers } from "./deal-breakers"
import type { GateProfile } from "@/lib/gates"
import { desktopDouble } from "@/test/doubles"

let profile: GateProfile
beforeEach(() => {
  profile = { languages: [], eligibility: null }
  window.desktop = desktopDouble()
  vi.mocked(window.desktop.request).mockImplementation(async (path: string, body?: unknown) => {
    const input = body as Record<string, unknown> | undefined
    if (path === "gates/profile") return profile
    if (path === "gates/languages" && input?.action === "remove") profile = { ...profile, languages: profile.languages.filter(item => item.id !== input.id) }
    else if (path === "gates/languages") {
      if (!input?.id && profile.languages.some(item => item.language.toLowerCase() === String(input?.language).trim().toLowerCase()))
        throw new Error(`${String(input?.language).trim()} is already in your languages. Edit its level instead.`)
      const item = { id: Number(input?.id ?? profile.languages.length + 1), language: String(input?.language), level: String(input?.level), notes: input?.notes ? String(input.notes) : null }
      profile = { ...profile, languages: [...profile.languages.filter(other => other.id !== item.id), item] }
    } else if (path === "gates/eligibility") profile = { ...profile, eligibility: input?.eligibility as GateProfile["eligibility"] }
    return profile
  })
})
afterEach(() => { delete window.desktop })
const field = (name: string) => screen.getByRole("textbox", { name })
const declared = () => within(screen.getByRole("list", { name: "Declared languages" }))

it("explains that both gates are off and that an undeclared language is a hard no", async () => {
  render(<DealBreakers />)
  expect(await screen.findByText(/Both gates are off, so no job fails/)).toHaveAttribute("role", "status")
  expect(screen.getByText(/An undeclared language counts as a hard no/)).toBeInTheDocument()
  expect(screen.getByText("No languages yet. Add your languages to enable the language gate.")).toBeInTheDocument()
  expect(screen.getByRole("radio", { name: "Not set" })).toBeChecked()
})

it("adds, edits the level of and removes a language", async () => {
  render(<DealBreakers />)
  await screen.findByRole("button", { name: "Add language" })
  expect(screen.getByRole("button", { name: "Add language" })).toBeDisabled()
  fireEvent.change(field("Language"), { target: { value: "Spanish" } })
  fireEvent.change(field("Level"), { target: { value: "Native" } })
  fireEvent.click(screen.getByRole("button", { name: "Add language" }))
  expect(await screen.findByRole("list", { name: "Declared languages" })).toHaveTextContent("SpanishNative")
  expect(window.desktop!.request).toHaveBeenCalledWith("gates/languages", { language: "Spanish", level: "Native", notes: "" })
  expect(field("Language")).toHaveValue("")
  expect(screen.queryByText(/Both gates are off/)).toBeNull()
  fireEvent.click(declared().getByRole("button", { name: "Edit level" }))
  fireEvent.change(screen.getByRole("textbox", { name: "Level of Spanish" }), { target: { value: "C2" } })
  fireEvent.click(declared().getByRole("button", { name: "Save level" }))
  await waitFor(() => expect(declared().getByText("C2")).toBeInTheDocument())
  expect(window.desktop!.request).toHaveBeenCalledWith("gates/languages", { id: 1, language: "Spanish", level: "C2", notes: "" })
  fireEvent.click(declared().getByRole("button", { name: "Edit level" }))
  fireEvent.click(declared().getByRole("button", { name: "Cancel" }))
  fireEvent.click(declared().getByRole("button", { name: "Remove Spanish" }))
  expect(await screen.findByText("No languages yet. Add your languages to enable the language gate.")).toBeInTheDocument()
})

it("shows the duplicate error and keeps the draft", async () => {
  profile = { languages: [{ id: 1, language: "Spanish", level: "Native", notes: null }], eligibility: null }
  render(<DealBreakers />)
  await screen.findByRole("list", { name: "Declared languages" })
  fireEvent.change(field("Language"), { target: { value: " spanish " } })
  fireEvent.change(field("Level"), { target: { value: "C1" } })
  fireEvent.click(screen.getByRole("button", { name: "Add language" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("spanish is already in your languages. Edit its level instead.")
  expect(field("Language")).toHaveValue(" spanish ")
})

it("sets and clears the work eligibility", async () => {
  render(<DealBreakers />)
  fireEvent.click(await screen.findByRole("radio", { name: "I need a visa or work permit" }))
  await waitFor(() => expect(screen.getByRole("radio", { name: "I need a visa or work permit" })).toBeChecked())
  expect(window.desktop!.request).toHaveBeenCalledWith("gates/eligibility", { eligibility: "needs_permission" })
  expect(screen.queryByText(/Both gates are off/)).toBeNull()
  fireEvent.click(screen.getByRole("radio", { name: "Not set" }))
  await waitFor(() => expect(window.desktop!.request).toHaveBeenLastCalledWith("gates/profile", undefined))
  expect(window.desktop!.request).toHaveBeenCalledWith("gates/eligibility", { eligibility: null })
})
