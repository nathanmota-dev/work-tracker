# Manual jobs

Use **Jobs → Add job** to save an opportunity without an agent or browser integration. A role title and company name are required. The URL, description, location, work type, compensation, assessment, status and requirements JSON can be added now or through **Edit job** later. Source and source job ID identify opportunities from external sites; LinkedIn IDs remain compatible with existing CLI users.

Saving a draft does not create an application or start an agent. The form lists missing preparation fields. Preparation requires a title, company, valid HTTP(S) URL and description; a LinkedIn ID allows the existing preparation flow to retrieve the description. **Prepare application** opens Apply with the saved job, where resume generation is an explicit action.

## API and CLI

- `POST /api/jobs/create` accepts job fields and returns `{ job, created, existing, missing }`. A new job returns 201; an existing identity returns 200 with `existing: true` and the original saved content.
- `POST /api/jobs/update` accepts a positive local `id` and the fields to change. Omitted fields are preserved; empty optional text clears that field. A conflicting identity returns 409 with `existing_id` when available.
- Writable fields are `title`, `company_name`, `link`, `description`, `location`, `work_type`, `comp`, `fit`, `status`, `requirements_json`, `source`, `source_job_id` and `linkedin_job_id`.
- `work-tracker job save --title 'Engineer' --company 'Example' --source careers --source-id 42 --link 'https://careers.example/jobs?id=42'` uses the same validation and deduplication rules. Existing records are reported explicitly. Rediscovery can refresh supplied fit/status fields; archived jobs stay archived.
- `work-tracker job update --id 1 --description 'Build services'` updates supplied fields through the same store.

## Identity and history

Identity matches use a source and source job ID, a LinkedIn job ID extracted from supported LinkedIn URLs, or a normalized URL. Titles alone never merge jobs. Normalization handles host casing, `www`, HTTP/HTTPS, trailing slashes, query ordering and ordinary page anchors. It retains ports, unknown query parameters and SPA route fragments, removes UTM parameters, and removes LinkedIn tracking parameters only on LinkedIn hosts.

Conflicting identities and ambiguous legacy duplicates require review. Existing duplicates are preserved during migration. Identity checks and writes run in one SQLite transaction, including CLI writes from separate processes. Editing does not rewrite application links, application card fields, run manifests or PDF artifacts. Finish or cancel an active preparation run before editing its job.

## Discovery and triage

Jobs owns discovery: enter keywords, location, work arrangement and page count.
Direct LinkedIn searches save structured results automatically; **Assess fit with
agent** opens the contextual job-scout panel with the same criteria. Each search
reports saved, already saved and failed items. Repeated searches preserve existing
jobs, including archived roles.

New jobs (including manual and CLI saves) appear in **New**, never directly in
**Shortlist**. Select one or several and choose **Move to shortlist** or **Archive**.
Shortlist retains filtering, selection and batch preparation. Archived jobs retain
their prior triage state on restoration. The search criteria and tab persist in
the URL; legacy Search job links redirect to Jobs. Search now finds only people.
