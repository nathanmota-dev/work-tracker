# Managed LaTeX resume generation

Use this mode only when Work Tracker provides a run manifest. The backend owns
compilation, application records and artifact registration. Do not create an
application with the CLI in this mode.

Read the manifest and its `profilePath`, plus all relevant `.tex` inputs in
`baseProject`. `profilePath` can contain null: then use only the actual resume
content. The working copy is `project`, with `mainFile` as its entrypoint.

Adapt content for the supplied `job.description`. Select projects and experience
bullets supported by the sources; emphasize the relevant technologies and results.
Follow the language of the job description; if it is unclear, keep the base
language. Preserve the original name and contact details, formatting commands,
fonts and margins. Preserve all LaTeX comments, including commented certifications;
comments are not evidence that a certification has been earned. Show education by
completion date. Do not invent missing accomplishments or metrics.

## Profile evidence

The profile at `profilePath` is the candidate's one structured source, built by
Work Tracker from their resume data file or their LinkedIn "Save to PDF" export,
in the resume data file's shape. It can contain `profileSources.references`: the
text of resumes the user already has as PDFs.

- Entries with `hidden: true` are left out of the base resume but are real
  history: use them when they prove something the target role needs.
- `profileSources.references` is evidence from the candidate's own history. It can
  supply bullets and experience proven there.
- Do not add an experience unrelated to the target role only because it exists.
- Translate a reference written in another language faithfully, without new claims.

## Variant target

A manifest without `job` and with `target` asks for a reusable resume for a job
profile, not for one posting: `target.role` (`frontend`, `backend`, `fullstack` or
`other`), `target.stacks`, an optional `target.focus` and `target.language`.

- Tailor the resume for that role and those stacks. Highlight the stacks and choose
  the projects and experience that prove them.
- Write the summary for the role, without naming a company or a posting.
- Follow `target.language` (`pt` or `en`); `auto` keeps the language of the base LaTeX.
- `coverPath` is null: do not write a cover letter.
- Write `selectionPath` with the same fields as for a job, plus `target`.
- **Never invent experience in a stack that is absent from the sources.** Record a
  requested stack without supporting evidence in `gaps` instead.

Edit only the working project's content. Escape LaTeX special characters in inserted
text, and keep existing custom commands usable. Use the base page count as a length
target: replace weaker material rather than appending all projects.

Write these outputs at the exact manifest paths:

- `selectionPath`: a JSON object with `language`, `selectedProjects`,
  `selectedExperience`, `changes` and `gaps`. Identify each selection by its name
  or source ID and explain why it supports this job. Include limitations from
  incomplete source entries.
- `reportPath`: a readable Markdown report with changes, supporting evidence,
  selected experience and genuine gaps.
- `coverPath`, when it is not null: a cover letter in the job's language, based on
  the same evidence.

On a correction attempt, address the backend's compilation/output diagnostics and
update these same files. Do not edit the original project or install dependencies.
