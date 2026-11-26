import type { ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import logo from "@/public/logo.png"

/** One dot per screen; the current one stretches into a pill. */
function Dots({ count, current }: { count: number; current: number }) {
  return <div aria-hidden className="flex items-center justify-center gap-1.5">
    {Array.from({ length: count }, (_, index) => <span key={index}
      className={cn("h-1.5 rounded-full transition-all duration-300", index === current ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/30")} />)}
  </div>
}

/**
 * @property [onBack] Absent on the first screen, which shows the app name instead.
 * @property [hint] Short note under the primary button, such as why it is disabled.
 */
export type ShellProps = {
  title: ReactNode
  description: ReactNode
  action: string
  actionDisabled?: boolean
  onAction: () => void
  onBack?: () => void
  hint?: ReactNode
  step: number
  steps: number
  children: ReactNode
}

/**
 * Full-screen setup card: the story and its primary action on the left, the
 * screen's content on the right. Stacks into one column on narrow windows.
 */
export function OnboardingShell({ title, description, action, actionDisabled, onAction, onBack, hint, step, steps, children }: ShellProps) {
  return <main className="relative flex min-h-svh items-center justify-center bg-background p-4 text-foreground sm:p-8">
    <div className="absolute top-3 right-3"><ModeToggle /></div>
    <section aria-label="Set up Work Tracker" className="grid w-full max-w-6xl overflow-hidden rounded-2xl border bg-card shadow-xs md:min-h-[600px] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex flex-col bg-muted/60 p-8 sm:p-10 dark:bg-muted/50">
        {onBack
          ? <button type="button" onClick={onBack} className="-ml-1 flex w-fit cursor-pointer items-center gap-1 rounded-md px-1 text-sm font-medium hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-ring">
            <ChevronLeft aria-hidden className="size-4" /> Back
          </button>
          : <div className="flex items-center gap-2 text-sm font-medium"><img src={logo} alt="" className="size-5 rounded" /> Work Tracker</div>}
        <h1 className="mt-4 text-4xl leading-[1.1] font-bold tracking-tight text-balance">{title}</h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
        <div className="mt-10 flex-1" />
        <Button variant="default" size="lg" disabled={actionDisabled} onClick={onAction}
          className="h-11 w-full cursor-pointer rounded-lg text-sm ring-4 ring-foreground/10 disabled:ring-0">
          {action}
        </Button>
        <div className="mt-3 min-h-5 text-center text-xs text-muted-foreground">{hint}</div>
        <div className="mt-4"><Dots count={steps} current={step} /></div>
        <p className="sr-only" aria-live="polite">Step {step + 1} of {steps}</p>
      </div>
      <div className="flex min-w-0 flex-col justify-center p-6 sm:p-10">{children}</div>
    </section>
  </main>
}
