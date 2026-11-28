import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ProfileUpload, fileSize } from "./profile-upload"
import { request } from "@/lib/api"
import { uploadProfileFile } from "@/lib/profile-sources"
vi.mock("@/lib/api", () => ({ useApi: vi.fn(), request: vi.fn(), publish: vi.fn(), subscribe: vi.fn() }))

const onUploaded = vi.fn()
const file = (name: string, text = "%PDF-1.7") => new File([text], name)
const result = (file: string, status: string, kind = "pdf", replaces?: string) => ({ upload: { file, kind, status, ...(replaces && { replaces }) } })
const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText("Choose profile files"), { target: { files } })
const row = (name: string) => screen.getByText(name).closest("li")!
beforeEach(() => { vi.mocked(request).mockReset(); onUploaded.mockClear() })

it("sends each chosen file as base64 and lists added and known files", async () => {
  vi.mocked(request).mockResolvedValueOnce(result("resume.pdf", "added")).mockResolvedValueOnce(result("linkedin.pdf", "unchanged"))
  render(<ProfileUpload disabled={false} onUploaded={onUploaded} />)
  expect(screen.getByLabelText("Choose profile files")).toHaveAttribute("accept", ".pdf,.json,application/pdf,application/json")
  choose(file("resume.pdf"), file("linkedin.pdf"))
  await waitFor(() => expect(row("linkedin.pdf")).toHaveTextContent("Already in your profile"))
  expect(row("resume.pdf")).toHaveTextContent("0.0 KBUploaded")
  expect(screen.getByText("Completed: 2")).toBeInTheDocument()
  expect(request).toHaveBeenNthCalledWith(1, "profile-sources/upload", { name: "resume.pdf", base64: btoa("%PDF-1.7") })
  expect(onUploaded).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }))
  expect(screen.queryByRole("region", { name: "Upload progress" })).toBeNull()
})

it("asks on the file before replacing the profile source, and drops it when declined", async () => {
  vi.mocked(request).mockResolvedValueOnce(result("resume-data.json", "replace_required", "data", "Profile.pdf")).mockResolvedValueOnce(result("resume-data.json", "added", "data"))
  render(<ProfileUpload disabled={false} onUploaded={onUploaded} />)
  choose(file("mine.json", "{}"))
  expect(await screen.findByRole("alertdialog", { name: "Replace profile source" })).toBeInTheDocument()
  expect(row("mine.json")).toHaveTextContent("Your profile is built from Profile.pdf. Replace it with this file? The current file is removed and your base resume is rebuilt.")
  expect(onUploaded).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Replace" }))
  await waitFor(() => expect(row("mine.json")).toHaveTextContent("Uploaded"))
  expect(request).toHaveBeenLastCalledWith("profile-sources/upload", { name: "mine.json", base64: btoa("{}"), replace: true })
  vi.mocked(request).mockResolvedValueOnce(result("resume-data.json", "replace_required", "data"))
  choose(file("other.json", "{}"))
  await waitFor(() => expect(row("other.json")).toHaveTextContent("Your profile is built from another file."))
  fireEvent.click(screen.getByRole("button", { name: "Keep current" }))
  expect(screen.queryByText("other.json")).toBeNull()
  expect(request).toHaveBeenCalledTimes(3)
})

it("reports each failed or unsupported file and continues with the others", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("bad.pdf is not a PDF.")).mockResolvedValueOnce(result("ok.pdf", "added"))
  render(<ProfileUpload disabled={false} onUploaded={onUploaded} />)
  choose(file("notes.txt", "x"), file("bad.pdf", "x"), file("ok.pdf"))
  await waitFor(() => expect(row("ok.pdf")).toHaveTextContent("Uploaded"))
  expect(row("bad.pdf")).toHaveTextContent("bad.pdf is not a PDF.")
  expect(row("notes.txt")).toHaveTextContent("Choose a PDF or a .json resume data file.")
  fireEvent.click(within(row("notes.txt")).getByRole("button", { name: "Remove notes.txt from the list" }))
  expect(screen.queryByText("notes.txt")).toBeNull()
  choose()
  expect(request).toHaveBeenCalledTimes(2)
})

it("opens the file picker from the drop zone, uploads dropped files and ignores both when disabled", async () => {
  vi.mocked(request).mockResolvedValue(result("dropped.pdf", "added"))
  const { rerender } = render(<ProfileUpload disabled={false} onUploaded={onUploaded} />)
  const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {})
  const zone = screen.getByRole("button", { name: "Upload profile files" })
  fireEvent.click(zone)
  fireEvent.keyDown(zone, { key: "Enter" })
  fireEvent.keyDown(zone, { key: "a" })
  expect(click).toHaveBeenCalledTimes(2)
  fireEvent.dragOver(zone)
  fireEvent.dragLeave(zone)
  fireEvent.drop(zone, { dataTransfer: { files: [file("dropped.pdf")] } })
  await waitFor(() => expect(row("dropped.pdf")).toHaveTextContent("Uploaded"))
  rerender(<ProfileUpload disabled onUploaded={onUploaded} />)
  expect(zone).toHaveAttribute("aria-disabled", "true")
  fireEvent.click(zone)
  fireEvent.keyDown(zone, { key: " " })
  fireEvent.drop(zone, { dataTransfer: { files: [file("late.pdf")] } })
  expect(click).toHaveBeenCalledTimes(2)
  expect(request).toHaveBeenCalledOnce()
})

it("formats sizes and uploads one file through the helper", async () => {
  expect(fileSize(2048)).toBe("2.0 KB")
  expect(fileSize(3 * 1024 * 1024)).toBe("3.0 MB")
  vi.mocked(request).mockResolvedValueOnce(result("a.pdf", "added"))
  await uploadProfileFile(file("a.pdf"), true)
  expect(request).toHaveBeenCalledWith("profile-sources/upload", { name: "a.pdf", base64: btoa("%PDF-1.7"), replace: true })
})
