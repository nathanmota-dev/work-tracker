import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

// Compact shadcn-style Radix select for labeled workspace forms.
const emptyValue = "__workspace_default__"
export function SelectControl({
  children,
  value,
  onChange,
  className,
  disabled,
  ...props
}: {
  children: React.ReactNode
  value: string
  onChange: (event: { target: { value: string } }) => void
  className?: string
  disabled?: boolean
  "aria-label"?: string
}) {
  const options = React.Children.toArray(children).filter(
    React.isValidElement,
  ) as React.ReactElement<{ value?: string; children: React.ReactNode }>[]
  return (
    <SelectPrimitive.Root
      value={value || emptyValue}
      onValueChange={(next) =>
        onChange({ target: { value: next === emptyValue ? "" : next } })
      }
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        {...props}
        className={cn(
          "flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&>span]:truncate",
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="relative z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <SelectPrimitive.ScrollUpButton className="flex justify-center py-1">
            <ChevronUp className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option, index) => {
              const optionValue =
                option.props.value ?? String(option.props.children)
              return (
                <SelectPrimitive.Item
                  key={index}
                  value={optionValue || emptyValue}
                  className="relative flex cursor-default select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground"
                >
                  <SelectPrimitive.ItemText>
                    {option.props.children}
                  </SelectPrimitive.ItemText>
                  <span className="absolute right-2 flex size-4 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                </SelectPrimitive.Item>
              )
            })}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex justify-center py-1">
            <ChevronDown className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
