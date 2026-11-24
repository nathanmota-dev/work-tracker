import { render, screen, within } from "@testing-library/react"
import { expect, it } from "vitest"
import { ResumeMatchDetail } from "./resume-match-detail"
import { desktopWith } from "@/test/variants"
import { documentScore, keyword } from "@/test/ats"

it("lists each resume's score with missing required terms first and the honesty note", async () => {
  const desktop = desktopWith({ "ats/jobs/7": { job_id: 7, keywords: [], documents: [
    documentScore({ matched: [keyword("Docker", "other"), keyword("C#")], missing: [keyword("Kafka", "preferred"), keyword("SQL Server")] }),
    documentScore({ document_key: "variant:n", variant_id: "n", label: "Back-End · Node.js", score: null, band: null, reason: "too_few_keywords", matched: [], missing: [] }),
  ] } })
  render(<ResumeMatchDetail jobId={7} />)
  const section = await screen.findByRole("region", { name: "Resume match" })
  expect(desktop.request).toHaveBeenCalledWith("ats/jobs/7", undefined)
  expect(section).toHaveTextContent("Resume match (ATS keywords)")
  const best = within(section).getByRole("listitem", { name: "Back-End · C#, .NET" })
  expect(best).toHaveTextContent("82 · Strong match")
  expect(best).toHaveTextContent("Missing: SQL Server (required), Kafka")
  expect(best).toHaveTextContent("Covered: C# (required), Docker")
  expect(within(section).getByRole("listitem", { name: "Back-End · Node.js" })).toHaveTextContent("Not enough keywords")
  expect(section).toHaveTextContent("It does not predict a hiring decision.")
})

it("renders nothing before any resume is scored", async () => {
  const desktop = desktopWith({ "ats/jobs/8": { job_id: 8, keywords: [], documents: [] } })
  const { container } = render(<ResumeMatchDetail jobId={8} />)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(desktop.request).toHaveBeenCalled()
  expect(container).toBeEmptyDOMElement()
})
