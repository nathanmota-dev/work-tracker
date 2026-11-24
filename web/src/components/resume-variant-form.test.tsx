import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ResumeVariantForm } from "./resume-variant-form"
import { desktopWith, variant } from "@/test/variants"
vi.mock("@/components/ui/select-control", () => ({ SelectControl: ({ children, ...props }: React.ComponentProps<"select">) => <select {...props}>{children}</select> }))

let desktop: ReturnType<typeof desktopWith>
const onClose = vi.fn()
beforeEach(() => {
  onClose.mockReset()
  desktop = desktopWith({ "acp/providers": { providers: [{ id: "opencode", displayName: "OpenCode", models: ["large"] }, { id: "claude-code", displayName: "Claude Code", models: [] }], default: "opencode" } })
})
const stacks = () => screen.getByRole("combobox", { name: "Stacks" })
function addStack(value: string) {
  fireEvent.change(stacks(), { target: { value } })
  fireEvent.keyDown(stacks(), { key: "Enter" })
}

it("generates a resume for a role and stacks with the selected agent, naming it from them by default", async () => {
  render(<ResumeVariantForm mode="generate" onClose={onClose} />)
  await screen.findByRole("option", { name: "Claude Code" })
  expect(screen.getByRole("button", { name: "Generate resume" })).toBeDisabled()
  addStack("C#"); addStack(".NET")
  fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "APIs" } })
  fireEvent.change(screen.getByLabelText("Language"), { target: { value: "pt" } })
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "large" } })
  expect(screen.getByLabelText("Name")).toHaveAttribute("placeholder", "Back-End · C#, .NET")
  fireEvent.click(screen.getByRole("button", { name: "Generate resume" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("resume-variants/generate", { name: "Back-End · C#, .NET", role: "backend", stacks: ["C#", ".NET"], focus: "APIs", language: "pt", provider: "opencode", model: "large" }))
  expect(onClose).toHaveBeenCalled()
})

it("edits only the name, role and stacks and shows a refusal", async () => {
  desktop.request.mockImplementation(async (path: string) => { if (path === "resume-variants/update") throw new Error("Name must have at most 80 characters."); return { providers: [], default: "" } })
  render(<ResumeVariantForm mode="edit" variant={variant()} onClose={onClose} />)
  expect(screen.queryByLabelText("Focus")).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "fullstack" } })
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "API resume" } })
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Name must have at most 80 characters.")
  expect(desktop.request).toHaveBeenCalledWith("resume-variants/update", { id: "v1", name: "API resume", role: "fullstack", stacks: ["C#", ".NET"] })
  expect(onClose).not.toHaveBeenCalled()
})

it("imports a chosen PDF", async () => {
  desktop.chooseSource.mockResolvedValueOnce(null).mockResolvedValueOnce("/home/user/resume.pdf")
  render(<ResumeVariantForm mode="import" onClose={onClose} />)
  addStack("React")
  expect(screen.getByRole("button", { name: "Import resume" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Choose PDF" }))
  await waitFor(() => expect(desktop.chooseSource).toHaveBeenCalledWith("pdf"))
  expect(screen.getByText("No file selected")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Choose PDF" }))
  expect(await screen.findByText("/home/user/resume.pdf")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Import resume" }))
  await waitFor(() => expect(desktop.request).toHaveBeenCalledWith("resume-variants/import", { name: "Back-End · React", role: "backend", stacks: ["React"], path: "/home/user/resume.pdf" }))
})
