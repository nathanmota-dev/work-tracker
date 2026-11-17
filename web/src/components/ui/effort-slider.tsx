import { useId } from "react"
import { Slider } from "radix-ui"
import { ChevronRight } from "lucide-react"

const thumbSize = 36

export function effortName(level: string) {
  if (!level) return "Default"
  if (level === "xhigh") return "Extra high"
  return level.charAt(0).toUpperCase() + level.slice(1)
}

/** Discrete effort picker: the first stop is the provider default, then each level from lowest to highest. */
export function EffortSlider({ label, levels, value, disabled, onChange }: {
  label: string
  levels: readonly string[]
  value: string
  disabled?: boolean
  onChange: (level: string) => void
}) {
  const id = useId()
  const stops = ["", ...levels]
  const index = Math.max(0, stops.indexOf(value))
  const name = effortName(stops[index] ?? "")
  const last = stops.length - 1
  return (
    <div className="flex min-w-0 flex-col gap-2 text-xs font-medium">
      <span id={id}>{label}</span>
      <div className={`rounded-3xl border bg-card px-4 pt-3 pb-4 shadow-sm ${disabled ? "opacity-50" : ""}`}>
        <p aria-hidden className="mb-3 flex items-center justify-center gap-1 text-base font-medium text-card-foreground">
          {name}
          <ChevronRight className="size-4 text-muted-foreground" />
        </p>
        <Slider.Root
          min={0}
          max={last}
          step={1}
          value={[index]}
          disabled={disabled}
          onValueChange={([next]) => onChange(stops[next ?? 0] ?? "")}
          className="relative flex h-9 w-full touch-none select-none items-center"
        >
          <Slider.Track className="relative h-8 grow overflow-hidden rounded-full bg-muted">
            <Slider.Range className="absolute h-full bg-blue-500" />
            {stops.map((stop, stopIndex) => (
              <span
                key={stop || "default"}
                aria-hidden
                className={`absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${stopIndex <= index ? "bg-white/60" : "bg-muted-foreground/40"}`}
                style={{ left: `calc(${thumbSize / 2}px + (100% - ${thumbSize}px) * ${last ? stopIndex / last : 0})` }}
              />
            ))}
          </Slider.Track>
          <Slider.Thumb
            aria-labelledby={id}
            aria-valuetext={name}
            className="block size-9 cursor-grab rounded-full border border-black/5 bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)] outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-blue-500/50 data-[disabled]:cursor-default"
          />
        </Slider.Root>
      </div>
    </div>
  )
}
