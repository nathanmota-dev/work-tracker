# Reusable answers

Answers offers a catalog of identity, contact, eligibility and link fields using
friendly labels. The common required basics are first name, last name and email;
individual portals may request additional answers. Missing and invalid values
remain pending and the catalog offers a button to add or correct each field.
Demographic fields always require human review, including when an answer is saved.
The matcher distinguishes ambiguous labels from missing answers and never invents
values or fills demographic fields.

Enable **Advanced mode** to edit custom keys and categories. Existing canonical
keys (for example `email`, `linkedin_url` and `work_authorization`) remain unchanged
for skills, direct SQL readers and existing CLI consumers. Known fields use their
catalog category and validate email addresses, phone numbers and HTTP(S) URLs.
Blank answers are treated as absent. Invalid legacy data is preserved for repair.

The `default` language version is the existing `applicant_answers` row. Migration
v6 adds `applicant_answer_variants` without rewriting legacy keys, values,
categories or timestamps. Each field can have one version per BCP 47 language tag,
such as `en` or `pt-BR`. Language tags are canonicalized, and there is no implicit
fallback between languages or to `default`.

Select a requested language and an optional **Explicit fallback language** to
inspect readiness. Fallback use is displayed with its actual source language.
Choose **Add language variant** on a saved answer to add a version. **Delete answer**
requires confirmation and removes only the selected version; other versions stay
saved. A failed save or deletion preserves previous data and keeps the editor open
with an error so it can be retried.

```bash
work-tracker answer set --key notice_period --value 'Two weeks'
work-tracker answer set --key notice_period --language pt-BR --value 'Duas semanas'
work-tracker answer list --language pt-BR
work-tracker match --labels '["Notice period"]' --language en --fallback-language default
work-tracker answer delete --key notice_period --language pt-BR
```

`answer list` without a language retains the legacy response shape. `match` without
a language reads the default version. Its additional `resolutions` object reports
language, status and whether the explicitly requested fallback was used. Matched
and unfilled entries retain the existing keys and reasons; invalid stored values
are reported as `invalid-answer`. `GET /api/answers` retains its default-only
contract; `/api/answers/variants` lists all versions and `/api/answers/catalog`
returns the field metadata. `POST /api/answer` accepts an optional `language` and
`POST /api/answer/delete` deletes one key and language version.
