import { expect, it } from "vitest"
import { batchReviewHref, nextReviewAction, unfinished } from "./batch-review"
import type { PreparationBatchItem } from "./preparation"
const item = (fields: Partial<PreparationBatchItem> = {}) => ({ id: "item", batchId: "batch", position: 1, jobId: 7, applicationId: null, runId: null, phase: "queued", status: "pending", result: "pending", adjustment: null, retryable: false, reviewRequired: false, ...fields }) as PreparationBatchItem
it("creates stable links and carries the PDF and activity display choices between batch items", () => {
  window.location.hash = "/apply?jobId=99&pdfTab=tailored&workspaceTab=report&batchId=old&itemId=old"
  const url = new URLSearchParams(batchReviewHref("batch", item({ applicationId: 8, runId: "run" }), true).split("?")[1])
  expect(Object.fromEntries(url)).toEqual({ batchId: "batch", itemId: "item", jobId: "7", applicationId: "8", runId: "run", pendingOnly: "true", pdfTab: "tailored", workspaceTab: "report" })
  window.location.hash = "/jobs"
  expect(batchReviewHref("batch")).toBe("#/apply?batchId=batch")
  expect(batchReviewHref("batch", item())).toBe("#/apply?batchId=batch&itemId=item&jobId=7")
  expect(unfinished(item({ result: "submitted" }))).toBe(false)
  expect(unfinished(item({ result: "cancelled" }))).toBe(false)
  expect(unfinished(item({ result: "filled" }))).toBe(true)
})
it("gives a concrete next action for stopped, pending and completed work", () => {
  expect(nextReviewAction(item({ status: "cancelled" }))).toContain("cancelled")
  expect(nextReviewAction(item({ status: "completed" }))).toContain("Submission confirmed")
  expect(nextReviewAction(item({ status: "waiting_for_decision" }))).toContain("permission")
  expect(nextReviewAction(item({ status: "waiting_for_sign_in" }))).toContain("signing in")
  expect(nextReviewAction(item({ retryable: true, reviewRequired: true }))).toContain("Review the portal")
  expect(nextReviewAction(item({ retryable: true }))).toContain("Correct the error")
  expect(nextReviewAction(item({ phase: "ready_for_review" }))).toContain("Review the PDF")
  expect(nextReviewAction(item({ phase: "waiting_for_fill" }))).toContain("queued for filling")
  expect(nextReviewAction(item({ phase: "in_review" }))).toContain("checklist")
  expect(nextReviewAction(item({ status: "running" }))).toContain("Wait for this execution")
  expect(nextReviewAction(item({ adjustment: "React" }))).toContain("requested adjustment is queued")
  expect(nextReviewAction(item())).toContain("queued for preparation")
  expect(nextReviewAction(item({ phase: "filling" }))).toContain("queued for filling")
  expect(nextReviewAction(item({ phase: "tailoring" }))).toContain("last checkpoint")
})
