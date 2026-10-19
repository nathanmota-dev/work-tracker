# Managed PDF application filling

Use this mode only when Work Tracker provides a fill manifest. It identifies
`applicationId`, `job`, `url`, an already validated `pdfPath` and `resultPath`.

Use exactly that PDF. Do not compile a resume, tailor another one, or create a new
application. Load answers with `work-tracker answer list`. Inspect the Chrome MCP
schemas, navigate to the employer's form, use `work-tracker detect-portal` and
`work-tracker match`, and fill only supported answers as described in the main
skill. A LinkedIn posting URL may require following its external Apply link to
reach the employer's form. Do not click a final application Submit button.

Verify the PDF filename appeared after uploading. Record unfilled fields and their
reasons; do not invent answers or fill demographic fields. Keep the browser open
for the candidate's review and manual submission. If sign-in is pending, report
that fact and let the candidate retry after signing in; do not write a completed
result.

After filling, write a JSON object to `resultPath`:

```json
{
  "versionId": "versionId from the manifest",
  "pdfHash": "pdfHash from the manifest",
  "pdfPath": "exact pdfPath attached to the portal",
  "fields": { "email": "actual value entered" },
  "unfilled": [{ "label": "Phone", "key": "phone", "reason": "no-stored-answer" }],
  "portal": "greenhouse",
  "externalUrl": "https://employer.example/application"
}
```

Key `fields` by the answer key from `work-tracker match` when there is one, and
by the visible label otherwise. For each `unfilled` entry, copy the matcher's
`label`, `key` and `skip` value as `reason` (`no-stored-answer`, `invalid-answer`,
`ambiguous`, `eeo-human-only` or `no-match`); describe any other blocker briefly
in `reason`. Work Tracker turns this into the candidate's review checklist and
links missing or invalid answers to Answers, so a corrected answer can be filled
again with the same approved PDF.

`fields` describes only values verified on the form. Include a resume entry only
after confirming the upload succeeded. Record the manifest’s version and hash only after the exact approved PDF was attached. Never report success for a different PDF. The backend persists this result to the
existing application and marks it filled. Do not mark it submitted.
