import { useState, type ReactNode } from "react"
import { Navigate, useNavigate } from "@tanstack/react-router"
import { ThemeProvider } from "@/components/theme-provider"
import { OnboardingShell } from "@/components/onboarding/onboarding-shell"
import { AgentStep } from "@/components/onboarding/agent-step"
import { ApplyPreview, DashboardPreview, DiscoverPreview, TrackPreview, WelcomePreview } from "@/components/onboarding/tour-previews"
import { saveOnboarding, useOnboarding, type OnboardingStatus } from "@/lib/onboarding"

type Screen = { title: ReactNode; description: ReactNode; action: string; content: (status?: OnboardingStatus) => ReactNode }
const AGENT = 1
const screens: Screen[] = [
  {
    title: "Welcome to Work Tracker",
    description: "Your job search in one place: find roles, apply with a tailored resume and keep every conversation moving. Setup takes a minute.",
    action: "Get started",
    content: () => <WelcomePreview />,
  },
  {
    title: "Connect your agent",
    description: "Work Tracker runs its searches, resumes and portal filling through Claude Code or opencode. Choose one and test it: the app opens once a test passes.",
    action: "Next",
    content: status => <AgentStep status={status} />,
  },
  {
    title: "Find your next role",
    description: "Search LinkedIn directly or ask your agent to find and rank roles against your profile. Triage them from New to your Shortlist.",
    action: "Next",
    content: () => <DiscoverPreview />,
  },
  {
    title: "Apply with confidence",
    description: "Pick a shortlisted role: the agent tailors your base resume, and it fills the job portal for you to review and submit.",
    action: "Next",
    content: () => <ApplyPreview />,
  },
  {
    title: "Keep it all moving",
    description: "Follow each application on the board, prepare for interviews and stay on top of recruiter follow-ups.",
    action: "Next",
    content: () => <TrackPreview />,
  },
  {
    title: <>You’re all set! <span aria-hidden>🎉</span></>,
    description: "Your agent is connected. The Dashboard’s Get started list walks you through your resume, essential answers and first application.",
    action: "Go to Dashboard",
    content: () => <DashboardPreview />,
  },
]

/** Full-screen setup shown before the workspace opens; `replay` reopens it from Settings. */
export function OnboardingPage({ replay = false }: { replay?: boolean }) {
  const { status } = useOnboarding()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  if (status?.setupCompletedAt && !replay && !busy) return <Navigate to="/dashboard" replace />
  const screen = screens[step]!
  const blocked = step === AGENT && !status?.agentReady
  async function next() {
    if (step < screens.length - 1) { setStep(step + 1); return }
    setBusy(true); setError("")
    try {
      if (!status?.setupCompletedAt) await saveOnboarding({ setupCompleted: true })
      await navigate({ to: "/dashboard", replace: true })
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Setup could not be saved. Check the workspace connection and try again.")
      setBusy(false)
    }
  }
  const hint = error ? <span role="alert" className="text-destructive">{error}</span>
    : blocked ? "Test Claude Code or opencode to continue." : null
  return <OnboardingShell title={screen.title} description={screen.description} action={busy ? "Opening…" : screen.action}
    actionDisabled={blocked || busy} onAction={() => void next()} onBack={step ? () => { setStep(step - 1); setError("") } : undefined}
    hint={hint} step={step} steps={screens.length}>
    {screen.content(status)}
  </OnboardingShell>
}

export function OnboardingRoute({ replay }: { replay?: boolean }) {
  return <ThemeProvider><OnboardingPage replay={replay} /></ThemeProvider>
}
