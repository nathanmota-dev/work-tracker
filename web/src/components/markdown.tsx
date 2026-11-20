import type { ComponentProps } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { openExternal } from "@/lib/api"

const components: ComponentProps<typeof ReactMarkdown>["components"] = {
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary underline underline-offset-2"
      onClick={event => { event.preventDefault(); if (href) void openExternal(href) }}
    >{children}</a>
  ),
  table: ({ children }) => <div className="my-3 overflow-x-auto rounded-md border"><table className="w-full border-collapse text-left text-xs">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tr: ({ children }) => <tr className="border-b last:border-b-0 even:bg-muted/20">{children}</tr>,
  th: ({ children }) => <th className="whitespace-nowrap px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1.5 align-top">{children}</td>,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-4 text-sm font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-muted/50 p-3 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
}

/** Renders agent text as GitHub-flavoured Markdown; raw HTML is not rendered. */
export function Markdown({ text }: { text: string }) {
  return <div className="break-words text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown></div>
}
