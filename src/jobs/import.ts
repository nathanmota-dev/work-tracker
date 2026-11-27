import { webUrl } from "./identity.ts";
import { fetchJobPage } from "./import-page.ts";
import { jobPostings, postingFields, selectPosting, type ImportedPosting } from "./import-posting.ts";
import { JobError } from "./store.ts";

/** Read a job page into form fields. Nothing is saved: the user reviews the draft first. */
export async function importJob(body: unknown): Promise<ImportedPosting> {
  const value = body && typeof body === "object" && "url" in body && typeof body.url === "string" ? body.url.trim() : "";
  const url = webUrl(value);
  if (!url) throw new JobError("Enter a valid HTTP or HTTPS job URL without credentials.");
  const postings = jobPostings(await fetchJobPage(url));
  if (!postings.length)
    throw new JobError("This page doesn't publish job data that Work Tracker can read. Fill in the fields manually.", 422);
  const posting = selectPosting(postings, url.href);
  if (!posting) throw new JobError("This page lists several jobs. Paste the link of a single job.", 422);
  return postingFields(posting, url.href);
}
