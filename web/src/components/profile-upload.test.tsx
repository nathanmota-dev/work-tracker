import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ProfileUpload } from "./profile-upload"
import { request } from "@/lib/api"
import { uploadProfileFile } from "@/lib/profile-sources"
vi.mock("@/lib/api", () => ({ useApi: vi.fn(), request: vi.fn(), publish: vi.fn(), subscribe: vi.fn() }))

const onUploaded = vi.fn()
const file = (name: string, text = "%PDF-1.7") => new File([text], name)
const result = (file: string, status: string, kind = "pdf") => ({ upload: { file, kind, status } })
const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText("Choose profile files"), { target: { files } })
beforeEach(() => { vi.mocked(request).mockReset(); onUploaded.mockClear() })

it("sends each chosen file as base64 and reports added and known files", async () => {
  vi.mocked(request).mockResolvedValueOnce(result("resume.pdf", "added")).mockResolvedValueOnce(result("linkedin.pdf", "unchanged"))
  render(<ProfileUpload disabled={false} onUploaded={onUploaded} />)
  expect(screen.getByLabelText("Choose profile files")).toHaveAttribute("accept", ".pdf,.json,application/pdf,application/json")
  choose(file("resume.pdf"), file("linkedin.pdf"))
  expect(await screen.findByRole("status")).toHaveTextContent("Added resume.pdf. Already in your profile: linkedin.pdf.")
  expect(request).toHaveBeenNthCalledWith(1, "profile-sources/upload", { name: "resume.pdf", base64: btoa("%PDF-1.7") })
  expect(onUploaded).toHaveBeenCalledOnce()
})

it("asks before replacing different resume data, and keeps it when declined", async () => {
  vi.mocked(request).mockResolvedValueOnce(result("resume-data.json", "replace_required", "data")).mockResolvedValueOnce(result("resume-data.json", "added", "data"))
  render(<ProfileUpload disabled={false} onUploaded={onUploaded} />)
  choose(file("mine.json", "{}"))
  const dialog = await screen.findByRole("alertdialog", { name: "Replace resume data" })
  expect(dialog).toHaveTextContent("Replace it with mine.json?")
  expect(onUploaded).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Replace" }))
  await waitFor(() => expect(request).toHaveBeenLastCalledWith("profile-sources/upload", { name: "mine.json", base64: btoa("{}"), replace: true }))
  expect(await screen.findByRole("status")).toHaveTextContent("Added resume-data.json.")
  vi.mocked(request).mockResolvedValueOnce(result("resume-data.json", "replace_required", "data"))
  choose(file("other.json", "{}"))
  fireEvent.click(await screen.findByRole("button", { name: "Keep current" }))
  expect(screen.queryByRole("alertdialog")).toBeNull()
  expect(request).toHaveBeenCalledTimes(3)
})

it("reports each failed file and continues with the others", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("bad.pdf is not a PDF.")).mockResolvedValueOnce(result("ok.pdf", "added"))
  render(<ProfileUpload disabled={false} onUploaded={onUploaded} />)
  choose(file("bad.pdf", "x"), file("ok.pdf"))
  expect(await screen.findByRole("alert")).toHaveTextContent("bad.pdf: bad.pdf is not a PDF.")
  expect(screen.getByRole("status")).toHaveTextContent("Added ok.pdf.")
  choose()
  expect(request).toHaveBeenCalledTimes(2)
})

it("opens the file picker and is disabled while the panel is busy", () => {
  const { rerender } = render(<ProfileUpload disabled={false} onUploaded={onUploaded} />)
  const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {})
  fireEvent.click(screen.getByRole("button", { name: "Add files" }))
  expect(click).toHaveBeenCalledOnce()
  rerender(<ProfileUpload disabled onUploaded={onUploaded} />)
  expect(screen.getByRole("button", { name: "Add files" })).toBeDisabled()
})

it("uploads one file through the helper", async () => {
  vi.mocked(request).mockResolvedValueOnce(result("a.pdf", "added"))
  await uploadProfileFile(file("a.pdf"), true)
  expect(request).toHaveBeenCalledWith("profile-sources/upload", { name: "a.pdf", base64: btoa("%PDF-1.7"), replace: true })
})
