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
- `coverPath`: a cover letter in the job's language, based on the same evidence.

On a correction attempt, address the backend's compilation/output diagnostics and
update these same files. Do not edit the original project or install dependencies.
