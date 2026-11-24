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

## Work fast: few browser round trips

Each Chrome MCP call is slow, so plan the whole form before touching it:

1. Run `work-tracker answer list` once, then one `take_snapshot` of the form. Scroll
   with `evaluate_script` only if fields are missing; do not re-snapshot per field.
2. Run `work-tracker match --labels '[...]'` once with **every** visible label,
   including Portuguese ones (accents are handled).
3. Fill all text, textarea, date and native select fields with one `fill_form` call
   (uid + value pairs). Do not call `fill` field by field. Open a combobox or
   custom dropdown only for fields that need it, one click for the dropdown and one
   for the option.
4. Upload the PDF with `upload_file`, then take one `take_snapshot` at the end to
   verify every value and the attached filename. Take at most one screenshot.
5. Use `job.title` from the manifest for "desired role" style fields
   (`desired_role`, "Cargo pretendido") when no saved answer exists, and say so in
   the result. Leave photo fields empty.
6. Write `resultPath` as soon as the final snapshot confirms the values. Do not
   keep exploring the page after that.

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
