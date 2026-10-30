import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { highlightCode, type Lang } from "./highlight";

/** A code file: its path in a header bar, a copy button, and the highlighted source. */
export function CodeBlock({ code, file, lang = "tsx", className }: { code: string; file: string; lang?: Lang; className?: string }) {
  return (
    <figure className={cn("min-w-0 overflow-hidden rounded-xl border border-border bg-[#0b0b0d]", className)}>
      <figcaption className="flex h-10 items-center justify-between gap-3 border-b border-border pl-4 pr-1.5">
        <span className="truncate font-mono text-[12.5px] text-muted-foreground">{file}</span>
        <CopyButton text={code} label={`Copy ${file}`} />
      </figcaption>
      <pre className="a2-code overflow-x-auto px-5 py-4 font-mono text-[13px] leading-[1.7]">
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }} />
      </pre>
    </figure>
  );
}

/** One shell command on a single line, with a prompt and a copy button. */
export function CommandLine({ command, className }: { command: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-xl border border-border bg-[#0b0b0d] py-1.5 pl-4 pr-1.5", className)}>
      <span className="select-none font-mono text-[14px] text-muted-foreground/60" aria-hidden="true">
        $
      </span>
      <code className="a2-code min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1.5 font-mono text-[14px]" dangerouslySetInnerHTML={{ __html: highlightCode(command, "sh") }} />
      <CopyButton text={command} label="Copy install command" />
    </div>
  );
}
