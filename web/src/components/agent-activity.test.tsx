import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { AgentActivity } from "./agent-activity"
it("keeps one compact command row with technical output collapsed", () => {
  const { container, rerender } = render(<AgentActivity message={{ id: "1", role: "system", text: "", tool: { title: "sqlite3 /private/data.db .tables", kind: "execute", status: "in_progress", output: "jobs\nrecruiters" } }} />)
  expect(screen.getByText("Run command")).toBeInTheDocument()
  expect(screen.getByText("Running")).toBeInTheDocument()
  expect(container.querySelector("details")).not.toHaveAttribute("open")
  fireEvent.click(container.querySelector("summary")!)
  expect(container.querySelector("details")).toHaveAttribute("open")
  rerender(<AgentActivity message={{ id: "1", role: "system", text: "", tool: { title: "sqlite3 /private/data.db .tables", kind: "execute", status: "completed", output: "jobs\nrecruiters" } }} />)
  expect(screen.getByText("Completed")).toBeInTheDocument()
  expect(container.querySelectorAll("details")).toHaveLength(1)
  expect(container.querySelector("details")).toHaveAttribute("open")
})
it("makes the sign-in instruction visible while retaining the original output", () => {
  render(<AgentActivity message={{ id: "1", role: "system", text: "", tool: { title: "linkedin_get_person_profile", kind: "fetch", status: "failed", output: "A LinkedIn login window is open and login is still in progress. This is not a failure." } }} />)
  expect(screen.getByText("Read LinkedIn profile")).toBeInTheDocument()
  expect(screen.getByText("Waiting for sign-in")).toBeVisible()
  expect(screen.queryByText("Failed")).not.toBeInTheDocument()
  expect(screen.getByText("Sign-in has not completed. Finish in the browser, then run this skill again to retry.")).toBeVisible()
})
