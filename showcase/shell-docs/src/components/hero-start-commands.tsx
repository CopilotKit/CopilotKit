"use client";

// <HeroStartCommands> — the docs hero's primary call-to-action. Presents the
// two recommended entry points as a side-by-side pair of cards so a visitor
// self-selects by situation rather than reading prose:
//
//   • "Start a new project"        → npx copilotkit@latest create
//   • "Add to an existing project" → npx copilotkit@latest skills onboard
//
// Both cards are equal weight (neutral surface, accent only on the icon and on
// hover) — no pre-selected default. Each command row is a single copy
// button (click anywhere on the row to copy) with an `aria-live` status sibling
// so the copy result is announced to assistive tech. Clipboard failures (insecure
// context, sandboxed iframe, permissions policy, in-app webview, older browsers)
// surface visually with an X + a "select manually" hint rather than silently
// no-op'ing — copying the command IS the feature.

import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Copy,
  FolderPlus,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

type CopyState = "idle" | "copied" | "error";

type StartCommand = {
  id: string;
  label: string;
  description: string;
  command: string;
  icon: LucideIcon;
};

// `createFramework` is the CLI's own `--framework` value (e.g. "langgraph-js"),
// NOT the docs slug — callers translate before passing it in. When set, the
// "new project" command pre-selects that framework so the framework landing
// pages recommend a ready-to-run command. `skills onboard` takes no framework
// flag (it hands the choice to your coding agent), so it's identical everywhere.
function buildCommands(createFramework?: string): StartCommand[] {
  // Pin `@latest` so npx always resolves the newest published CLI instead of
  // silently reusing a stale cached `copilotkit` from a previous run — matches
  // the convention used everywhere else in the docs.
  const createCommand = createFramework
    ? `npx copilotkit@latest create --framework ${createFramework}`
    : "npx copilotkit@latest create";
  return [
    {
      id: "create",
      label: "Start a new project",
      description: "Scaffold a fresh CopilotKit app",
      command: createCommand,
      icon: Sparkles,
    },
    {
      id: "onboard",
      label: "Add to an existing project",
      description: "Wire CopilotKit into your codebase",
      command: "npx copilotkit@latest skills onboard",
      icon: FolderPlus,
    },
  ];
}

function CommandCard({
  label,
  description,
  command,
  icon: Icon,
}: StartCommand) {
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copied = copyState === "copied";
  const errored = copyState === "error";

  const onCopy = async () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      console.warn("[hero-start-commands] clipboard write failed", err);
      setCopyState("error");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2500);
    }
  };

  const copyAriaLabel = errored
    ? `Copy failed for "${command}" — select the command text manually`
    : `Copy command: ${command}`;

  let status = "";
  if (copied) status = `Copied ${command} to clipboard`;
  else if (errored)
    status = "Clipboard blocked; select the command text manually";

  return (
    <div className="shell-docs-radius-surface flex min-w-0 flex-col gap-3 border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)]">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="shell-docs-radius-icon flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--accent-dim)] text-[var(--accent)]"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text)]">
            {label}
          </div>
          <div className="text-[12px] leading-snug text-[var(--text-muted)]">
            {description}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onCopy}
        aria-label={copyAriaLabel}
        title={command}
        className={`shell-docs-radius-control group flex h-10 w-full cursor-pointer items-center gap-2 border bg-[var(--bg-elevated)] px-3 text-left font-mono text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          errored
            ? "border-red-500 text-[var(--text-secondary)]"
            : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]"
        }`}
      >
        <span
          aria-hidden="true"
          className="select-none text-[var(--text-faint)]"
        >
          $
        </span>
        <span className="min-w-0 flex-1 truncate">{command}</span>
        <span
          aria-hidden="true"
          className={`shrink-0 transition-colors ${
            errored
              ? "text-red-500"
              : copied
                ? "text-[var(--accent)]"
                : "text-[var(--text-muted)] group-hover:text-[var(--accent)]"
          }`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : errored ? (
            <X className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      <span aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}

// The two-card grid on its own — shared by the home hero and the framework
// landing heroes so the "new project / existing project" recommendation reads
// identically everywhere. Callers own the surrounding layout (width cap,
// adjacent CTAs, footer links). Pass `createFramework` (a CLI `--framework`
// value) on framework pages to pre-select that framework in the create command.
export function StartCommandCards({
  createFramework,
}: {
  createFramework?: string;
} = {}) {
  // A framework-pinned `create` command (e.g. `--framework langgraph-js`) is
  // long, so stack the cards in a single column to keep it fully readable. The
  // short home commands sit side-by-side from `sm` up. Using a grid means the
  // two columns are always constrained to the container — a long command can
  // never push the second card off-screen (it truncates within its track).
  const stacked = Boolean(createFramework);
  return (
    <div className={`grid gap-3 ${stacked ? "" : "sm:grid-cols-2"}`}>
      {buildCommands(createFramework).map((command) => (
        <CommandCard key={command.id} {...command} />
      ))}
    </div>
  );
}

export function HeroStartCommands() {
  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <StartCommandCards />
      <Link
        href="/build-with-agents"
        prefetch={false}
        className="inline-flex items-center gap-1 self-start rounded text-[13px] font-medium text-[var(--accent)] no-underline transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:underline"
      >
        Learn more about building with agents
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
