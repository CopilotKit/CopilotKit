import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { highlightCode } from "./highlight";
import type { Lang } from "./highlight";

/** The one surface every code thing on Get started sits on: files, commands and the prompt. */
export const CODE_SURFACE =
  "rounded-[10px] border border-border bg-[oklch(0.975_0.003_285)] dark:bg-[#0b0b0d]";
/** Its colour, for a fade that has to end in it. */
export const CODE_FADE =
  "bg-gradient-to-t from-[oklch(0.975_0.003_285)] via-[oklch(0.975_0.003_285)]/90 to-transparent dark:from-[#0b0b0d] dark:via-[#0b0b0d]/90";

/** A code file: its path in a header bar, a copy button, and the highlighted source. */
export function CodeBlock({
  code,
  file,
  lang = "tsx",
  className,
}: {
  code: string;
  file: string;
  lang?: Lang;
  className?: string;
}) {
  return (
    <figure
      className={cn(`min-w-0 overflow-hidden ${CODE_SURFACE}`, className)}
    >
      <figcaption className="flex min-h-10 items-center justify-between gap-3 border-b border-border py-1 pl-4 pr-1.5">
        <span className="min-w-0 break-all font-mono text-[12.5px] text-muted-foreground">
          {file}
        </span>
        <CopyButton text={code} label={`Copy ${file}`} />
      </figcaption>
      <pre className="a2-code overflow-x-auto px-5 py-4 font-mono text-[13px] leading-[1.7]">
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }} />
      </pre>
    </figure>
  );
}

/** One shell command on a single line, with a prompt and a copy button. */
export function CommandLine({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        `flex min-w-0 items-center gap-3 py-1.5 pl-4 pr-1.5 ${CODE_SURFACE}`,
        className,
      )}
    >
      <span
        className="select-none font-mono text-[13px] text-muted-foreground/60"
        aria-hidden="true"
      >
        $
      </span>
      <code
        className="a2-code min-w-0 flex-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-1.5 font-mono text-[13px]"
        dangerouslySetInnerHTML={{ __html: highlightCode(command, "sh") }}
      />
      <CopyButton text={command} label="Copy command" />
    </div>
  );
}
