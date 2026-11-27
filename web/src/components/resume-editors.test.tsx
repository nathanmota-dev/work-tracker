import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChipListEditor } from "./chip-list-editor"
import { ResumeEntryEditor } from "./resume-entry-editor"
import type { ResumeEntry } from "../../../src/profile/types"

vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({ value, onChange, ...props }: { value: string; onChange: (value: string) => void; "aria-label"?: string }) =>
    <input aria-label={props["aria-label"]} value={value} onChange={e => onChange(e.target.value)} />,
}))

const role = (patch: Partial<ResumeEntry> = {}): ResumeEntry => ({ title: "Developer", organization: "Acme", start: "2024-01", end: "Present", location: "", bullets: ["Built things"], skills: ["React"], source: "data", ...patch })

describe("ResumeEntryEditor", () => {
  it("edits, adds, moves and removes entries, saving the tidied list", async () => {
    const onSave = vi.fn()
    render(<ResumeEntryEditor kind="experience" entries={[role(), role({ title: "Intern", start: "2023-01", end: "2023-12" })]} onClose={vi.fn()} onSave={onSave} />)
    const save = screen.getByRole("button", { name: "Save changes" })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /Developer/ }))
    expect(screen.getByLabelText("Start")).toHaveValue("2024-01-01")
    expect(screen.getByLabelText("End")).toHaveValue("Present")
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Senior Developer" } })
    fireEvent.change(screen.getByLabelText("What you did"), { target: { value: "Led a team\n\n Shipped  " } })
    fireEvent.change(screen.getByLabelText("Stack"), { target: { value: "React, , AWS" } })
    fireEvent.click(screen.getByLabelText("I currently work here"))
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2025-06-30" } })
    fireEvent.click(screen.getByRole("button", { name: "Move down" }))
    fireEvent.click(screen.getByRole("button", { name: "Add experience" }))
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "  New Co " } })
    fireEvent.click(screen.getByRole("button", { name: /Intern/ }))
    fireEvent.click(screen.getByRole("button", { name: "Remove experience" }))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { ...role(), organization: "New Co", title: "", start: "", end: "", bullets: [], skills: [] },
      role({ title: "Senior Developer", end: "2025-06-30", bullets: ["Led a team", "Shipped"], skills: ["React", "AWS"] }),
    ]))
  })
  it("edits education without bullets, shows errors and closes on Escape", async () => {
    const onClose = vi.fn()
    render(<ResumeEntryEditor kind="education" entries={[role({ title: "", organization: "UFU", end: "" })]} onClose={onClose} onSave={() => Promise.reject(new Error("Not saved."))} />)
    const list = screen.getByRole("list", { name: "Education entries" })
    fireEvent.click(within(list).getByRole("button", { name: /UFU/ }))
    expect(screen.queryByLabelText("What you did")).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("In progress"))
    expect(screen.getByLabelText("End")).toHaveValue("In progress")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved.")
    fireEvent.keyDown(screen.getByLabelText("Degree"), { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })
})

describe("ChipListEditor", () => {
  it("adds typed items without duplicates, removes chips and saves", async () => {
    const onSave = vi.fn()
    render(<ChipListEditor items={["React"]} label="Skills" placeholder="Add" onClose={vi.fn()} onSave={onSave} />)
    const input = screen.getByLabelText("Add to skills")
    fireEvent.change(input, { target: { value: "react, AWS" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getByRole("list", { name: "Skills" })).toHaveTextContent("ReactAWS")
    fireEvent.click(screen.getByRole("button", { name: "Remove React" }))
    fireEvent.change(input, { target: { value: "Go" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["AWS", "Go"]))
  })
  it("adds with the button and cancels", () => {
    const onClose = vi.fn()
    render(<ChipListEditor items={[]} label="Certifications" placeholder="Add" onClose={onClose} onSave={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Add to certifications"), { target: { value: "AWS CP" } })
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    expect(screen.getByRole("list", { name: "Certifications" })).toHaveTextContent("AWS CP")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onClose).toHaveBeenCalled()
  })
})
