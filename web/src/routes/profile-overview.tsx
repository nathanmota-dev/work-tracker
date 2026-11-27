import { useEffect, useState, type ReactNode } from "react"
import { FileUp, Pencil, Sparkles } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { LoadState } from "@/components/workspace-ui"
import { ProfileSources } from "@/components/profile-sources"
import { InlineAnswers } from "@/components/profile-inline-edit"
import { MissingSummary, ProfileChecklist, type ProfileCheck } from "@/components/profile-checklist"
import { ChipListEditor } from "@/components/chip-list-editor"
import { ResumeEntryEditor } from "@/components/resume-entry-editor"
import { Chips, EditButton, ProfileLink, ProfileSection, SectionEmpty, Timeline } from "@/components/profile-resume"
import { initials } from "@/components/opportunity-card"
import { useApi, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
import { profileValue, syncProfileOnce, SOURCE_LABELS } from "@/lib/profile-details"
import { useProfileSources } from "@/lib/profile-sources"
import { ANSWER_CATALOG, answerEntries } from "../../../src/answers/catalog"
import type { PersonalSource, ResumeEntry } from "../../../src/profile/types"

/** Sections edited in place, by id, with the answers each one holds. */
const SECTIONS: Record<string, string[]> = {
  roles: ["desired_role"],
  about: ["summary"],
  languages: ["languages"],
  contact: ["first_name", "last_name", "full_name", "email", "phone", "birth_date"],
  address: ["location", "country", "state", "city", "neighborhood", "address", "postal_code"],
  links: ["linkedin_url", "github_url", "portfolio_url", "social_links"],
  preferences: ["preferred_locations", "experience_level", "professional_category"],
}
const DETAILS: [string, string][] = [["contact", "Contact"], ["address", "Address"], ["links", "Links"], ["preferences", "Preferences"]]
const label = (key: string) => ANSWER_CATALOG.find(spec => spec.key === key)?.label ?? key
const sectionOf = (key: string) => Object.entries(SECTIONS).find(([, keys]) => keys.includes(key))?.[0] ?? null

/** Everything the page reads: saved answers and the consolidated resume sources. */
function useProfileView() {
  const answers = useApi<Row[]>("answers/variants")
  const sources = useProfileSources()
  const refreshSources = sources.refresh
  // Opening the profile imports new PDFs and fills empty answers once per session.
  useEffect(() => { void syncProfileOnce().then(state => { if (state) refreshSources() }) }, [refreshSources])
  const rows = (answers.data ?? []).filter(row => (row.language ?? "default") === "default")
  const value = (key: string) => profileValue(rows, key).value
  const about = sources.data?.about
  const resume = sources.data?.resume ?? { experience: [], education: [] }
  const name = value("full_name") || [value("first_name"), value("last_name")].filter(Boolean).join(" ")
  const roles = answerEntries(value("desired_role"))
  const summary = value("summary") || about?.summary || ""
  const languages = value("languages") ? answerEntries(value("languages")) : (about?.languages ?? []).map(item => [item.name, item.level].filter(Boolean).join(" · "))
  const checks: ProfileCheck[] = [
    { id: "name", label: "Your name", hint: "How recruiters and portals address you.", done: !!name, answer: "full_name" },
    { id: "email", label: "Email", hint: "Portals require it to send you updates.", done: !!value("email"), answer: "email" },
    { id: "phone", label: "Phone", hint: "Most application forms ask for it.", done: !!value("phone"), answer: "phone" },
    { id: "location", label: "Location", hint: "City and country you apply from.", done: !!value("location"), answer: "location" },
    { id: "linkedin", label: "LinkedIn profile", hint: "Linked from your resume and applications.", done: !!value("linkedin_url"), answer: "linkedin_url" },
    { id: "roles", label: "Roles of interest", hint: "The roles you are looking for.", done: roles.length > 0, answer: "desired_role" },
    { id: "summary", label: "A summary about you", hint: "Who you are, what you do and what you look for.", done: !!summary, answer: "summary" },
    { id: "languages", label: "Languages", hint: "Each language with your level.", done: languages.length > 0, answer: "languages" },
    { id: "experience", label: "Experience", hint: "Import your LinkedIn PDF or resume data.", done: resume.experience.length > 0 },
    { id: "education", label: "Education", hint: "Import your LinkedIn PDF or resume data.", done: resume.education.length > 0 },
    { id: "skills", label: "Skills", hint: "Import your LinkedIn PDF or resume data.", done: !!about?.skills.length },
  ]
  return { answers, rows, value, about, resume, name, roles, summary, languages, checks }
}
type View = ReturnType<typeof useProfileView>
/** Which section is open for editing, and how to open, close and save it. */
type Editing = { section: string | null; open: (section: string) => void; close: () => void; saved: (notice?: string) => void }
/** Resume sections changed on this page; they are not written to the resume data yet. */
type ResumeEdits = Partial<{ experience: ResumeEntry[]; education: ResumeEntry[]; skills: string[]; certifications: string[] }>
const LOCAL_NOTICE = "Changes are shown on this page only; saving them to your resume data is not connected yet."

function ProfileHeader({ view, onImport }: { view: View; onImport: () => void }) {
  const { value, name, about } = view
  const headline = about?.headline || view.roles.join(" · ")
  const contacts = [value("location"), value("phone"), value("email")].filter(Boolean)
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar className="size-14 text-base"><AvatarFallback>{initials(name || "You")}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-medium">{name || "Your profile"}</h2>
          {headline && <p className="mt-0.5 text-sm text-muted-foreground">{headline}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => prepareSkill("experience-bank")}><Sparkles /> Update experiences</Button>
          <Button size="sm" onClick={onImport}><FileUp /> Import resume</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <ProfileLink href={value("linkedin_url")}>LinkedIn</ProfileLink>
        <ProfileLink href={value("github_url")}>GitHub</ProfileLink>
        <ProfileLink href={value("portfolio_url")}>Portfolio</ProfileLink>
        {contacts.map(item => <span key={item} className="text-muted-foreground">{item}</span>)}
        <MissingSummary count={view.checks.filter(check => !check.done).length} total={view.checks.length} />
      </div>
    </header>
  )
}

/** A section's content, or its fields while it is being edited. */
function Editable({ id, view, editing, defaults, columns, children }: { id: string; view: View; editing: Editing; defaults?: Record<string, string>; columns?: 1 | 2; children: ReactNode }) {
  if (editing.section !== id) return <>{children}</>
  return <InlineAnswers keys={SECTIONS[id]!} rows={view.rows} defaults={defaults} columns={columns} onClose={editing.close} onSaved={editing.saved} />
}
const editAction = (id: string, title: string, editing: Editing) =>
  editing.section === id ? undefined : <EditButton label={`Edit ${title.toLowerCase()}`} onClick={() => editing.open(id)} />

/** The saved answers behind the profile, by group; a group opens its fields in place. */
function PersonalDetails({ view, editing }: { view: View; editing: Editing }) {
  return (
    <div className="space-y-5">
      {DETAILS.map(([id, title]) => (
        <div key={id} id={`profile-${id}`} className="scroll-mt-6">
          <div className="mb-1 flex items-center justify-between px-2">
            <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
            {editAction(id, title, editing)}
          </div>
          <Editable id={id} view={view} editing={editing}>
            <ul>
              {SECTIONS[id]!.map(key => {
                const { value, origin } = profileValue(view.rows, key)
                return (
                  <li key={key}>
                    <button type="button" aria-label={`Edit ${label(key)}`} title={value ? `${value}${origin ? ` · ${origin}` : ""}` : `Add ${label(key)}`} onClick={() => editing.open(id)}
                      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label(key)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{value || <span className="text-muted-foreground">—</span>}</span>
                      <Pencil aria-hidden className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </Editable>
        </div>
      ))}
    </div>
  )
}

/** Where the profile's data comes from: the source of the saved name, shown under the details. */
function sourceNote(rows: Row[]) {
  const source = rows.find(row => row.key === "full_name")?.autofill_source as PersonalSource | undefined
  return source && SOURCE_LABELS[source] ? `${SOURCE_LABELS[source]}. Your own edits are never replaced.` : "Your own edits are never replaced by an import."
}

function ProfileBody({ view, editing, edits, setEdits, importResume }: { view: View; editing: Editing; edits: ResumeEdits; setEdits: (edits: ResumeEdits) => void; importResume: () => void }) {
  const experience = edits.experience ?? view.resume.experience
  const education = edits.education ?? view.resume.education
  const skills = edits.skills ?? view.about?.skills ?? []
  const certifications = edits.certifications ?? view.about?.certifications ?? []
  const keep = (patch: ResumeEdits) => { setEdits({ ...edits, ...patch }); editing.saved(LOCAL_NOTICE) }
  const importAction = <Button size="sm" variant="outline" onClick={importResume}>Import resume</Button>
  return <>
    <ProfileSection id="profile-roles" title="Roles of interest" count={view.roles.length} action={editAction("roles", "Roles of interest", editing)}>
      <Editable id="roles" view={view} editing={editing}>
        {view.roles.length ? <Chips items={view.roles} label="Roles of interest" /> : <SectionEmpty>Add the roles you are looking for.</SectionEmpty>}
      </Editable>
    </ProfileSection>
    <ProfileSection id="profile-about" title="About" action={editAction("about", "Summary", editing)}>
      <Editable id="about" view={view} editing={editing} defaults={{ summary: view.summary }}>
        {view.summary ? <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{view.summary}</p> : <SectionEmpty>A few lines about who you are and what you look for.</SectionEmpty>}
      </Editable>
    </ProfileSection>
    <ProfileSection id="profile-experience" title="Experience" count={experience.length} action={editAction("experience", "Experience", editing)}>
      {editing.section === "experience" ? <ResumeEntryEditor kind="experience" entries={experience} onClose={editing.close} onSave={entries => keep({ experience: entries })} />
        : experience.length ? <Timeline entries={experience} label="Experience" /> : <SectionEmpty action={importAction}>No experience yet. Add it here or import your LinkedIn PDF or resume data.</SectionEmpty>}
    </ProfileSection>
    <ProfileSection id="profile-education" title="Education" count={education.length} action={editAction("education", "Education", editing)}>
      {editing.section === "education" ? <ResumeEntryEditor kind="education" entries={education} onClose={editing.close} onSave={entries => keep({ education: entries })} />
        : education.length ? <Timeline entries={education} label="Education" limit={4} /> : <SectionEmpty action={importAction}>No education yet.</SectionEmpty>}
    </ProfileSection>
    <ProfileSection id="profile-skills" title="Skills" count={skills.length} action={editAction("skills", "Skills", editing)}>
      {editing.section === "skills" ? <ChipListEditor items={skills} label="Skills" placeholder="e.g. TypeScript, React, AWS" onClose={editing.close} onSave={items => keep({ skills: items })} />
        : skills.length ? <Chips items={skills} label="Skills" /> : <SectionEmpty action={importAction}>No skills yet.</SectionEmpty>}
    </ProfileSection>
    <ProfileSection id="profile-languages" title="Languages" count={view.languages.length} action={editAction("languages", "Languages", editing)}>
      <Editable id="languages" view={view} editing={editing} defaults={{ languages: view.languages.join(", ") }}>
        {view.languages.length ? <Chips items={view.languages} label="Languages" /> : <SectionEmpty>Include your level in each one.</SectionEmpty>}
      </Editable>
    </ProfileSection>
    <ProfileSection id="profile-certifications" title="Certifications" count={certifications.length} action={editAction("certifications", "Certifications", editing)}>
      {editing.section === "certifications" ? <ChipListEditor items={certifications} label="Certifications" placeholder="e.g. AWS Cloud Practitioner" onClose={editing.close} onSave={items => keep({ certifications: items })} />
        : certifications.length ? <Chips items={certifications} label="Certifications" /> : <SectionEmpty>Courses and certificates worth showing on a resume.</SectionEmpty>}
    </ProfileSection>
  </>
}

/** One section in edit mode at a time; opening one from the checklist scrolls to it. */
function useEditing(): Editing & { notice: string } {
  const [section, setSection] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  return {
    section, notice,
    open: (id: string) => {
      setNotice(""); setSection(id)
      requestAnimationFrame(() => document.getElementById(`profile-${id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" }))
    },
    close: () => setSection(null),
    saved: (notice = "Profile saved.") => { setSection(null); setNotice(notice) },
  }
}

/**
 * The candidate's profile read like a resume: identity, roles of interest,
 * experience, education and skills from the resume sources, with what is
 * missing and the personal details beside it. Answers are edited in place,
 * one section at a time; files are imported from a side sheet.
 */
export function ProfileOverview() {
  const view = useProfileView()
  const editing = useEditing()
  const [importing, setImporting] = useState(false)
  const [edits, setEdits] = useState<ResumeEdits>({})
  const answer = (key: string) => { const id = sectionOf(key); if (id) editing.open(id) }
  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-10">
        <LoadState loading={view.answers.loading && !view.answers.data} error={view.answers.error} retry={view.answers.refresh} />
        <ProfileHeader view={view} onImport={() => setImporting(true)} />
        {editing.notice && <p role="status" className="text-sm">{editing.notice}</p>}
        <ProfileBody view={view} editing={editing} edits={edits} setEdits={setEdits} importResume={() => setImporting(true)} />
      </div>
      <aside className="space-y-6 lg:sticky lg:top-0 lg:self-start">
        <ProfileChecklist checks={view.checks} onAnswer={answer} onImport={() => setImporting(true)} />
        <section aria-label="Personal details" className="rounded-2xl border p-4">
          <h2 className="px-2 font-medium">Personal details</h2>
          <p className="mt-1 mb-4 px-2 text-xs text-muted-foreground">Applications fill forms with these answers. {sourceNote(view.rows)}</p>
          <PersonalDetails view={view} editing={editing} />
        </section>
      </aside>
      <Sheet open={importing} onOpenChange={setImporting}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          <SheetHeader className="border-b px-6 py-5 pr-12">
            <SheetTitle>Resume files</SheetTitle>
            <SheetDescription>Import your LinkedIn PDF, resume PDFs or resume data (.json). You review conflicts before they are used.</SheetDescription>
          </SheetHeader>
          <div className="p-6"><ProfileSources /></div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
