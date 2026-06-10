"use client";

// <HeroStartActions> — the docs hero's primary call-to-action, shared verbatim
// by the home hero and the framework landing heroes so both surfaces read
// identically. Presents the two recommended entry points as a side-by-side
// pair of cards so a visitor self-selects by situation rather than reading
// prose, with the quickstart CTA in an action row beneath:
//
//   • "Start a new project"        → npx copilotkit@latest create
//   • "Add to an existing project" → npx copilotkit@latest skills onboard
//   • Quickstart                   → guided docs walkthrough
//
// Both cards are equal weight (neutral surface, accent only on the icon and on
// hover) — no pre-selected default. Command text wraps rather than truncates,
// so a long framework-pinned create command is always fully readable. Each
// command row is a single copy
// button (click anywhere on the row to copy) with an `aria-live` status sibling
// so the copy result is announced to assistive tech. Clipboard failures (insecure
// context, sandboxed iframe, permissions policy, in-app webview, older browsers)
// surface visually with an X + a "select manually" hint rather than silently
// no-op'ing — copying the command IS the feature.

import React from "react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { ArrowRight, Check, Copy, FolderPlus, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
  id,
  label,
  description,
  command,
  icon: Icon,
}: StartCommand) {
  const posthog = usePostHog();
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
    // Distinguishes WHICH hero card was copied (create vs onboard) — the
    // global <CopyTracker> patch on navigator.clipboard.writeText already
    // emits the generic `cli_command_copied` volume event for this same copy,
    // so this intentionally uses a different event name to avoid
    // double-counting that funnel. `command` is page content (bounded
    // cardinality: bare + one variant per CLI framework), not user input.
    //
    // `location` mirrors the pathname `cli_command_copied` records, so the two
    // paired events join on the same dimension. It's the only surface signal
    // for the `onboard` card, whose command is byte-identical on the home hero
    // and every framework landing hero (only `create` embeds the framework in
    // `command`). Guarded for SSR to match the <CopyTracker> sibling, though
    // onCopy only runs from a browser click.
    const trackHeroCopy = (clipboardBlocked: boolean) => {
      try {
        posthog?.capture("hero_command_copied", {
          command_id: id,
          command,
          clipboard_blocked: clipboardBlocked,
          location:
            typeof window !== "undefined"
              ? window.location.pathname
              : undefined,
        });
      } catch {
        // Never let analytics break the copy interaction.
      }
    };
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
      trackHeroCopy(false);
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      console.warn("[hero-start-commands] clipboard write failed", err);
      setCopyState("error");
      trackHeroCopy(true);
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
        className={`shell-docs-radius-control group mt-auto flex min-h-10 w-full cursor-pointer items-start gap-2 border bg-[var(--bg-elevated)] px-3 py-2.5 text-left font-mono text-[12px] leading-[1.5] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
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
        {/* Long commands wrap at spaces only — each token is non-breaking so
            a flag like `--framework` can never split mid-token (a bare `-` at
            a line edge reads as a dash). `text-wrap: balance` makes the
            two-line case split evenly, typically right at the flag boundary. */}
        <span className="min-w-0 flex-1 [text-wrap:balance]">
          {command.split(" ").map((token, i) => (
            <React.Fragment key={i}>
              {i > 0 ? " " : null}
              <span className="whitespace-nowrap">{token}</span>
            </React.Fragment>
          ))}
        </span>
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
// identically everywhere. The grid is always two-up from `sm` so both surfaces
// share one layout; long framework-pinned commands wrap (never truncate) and
// `items-stretch` keeps the pair the same height. Pass `createFramework` (a
// CLI `--framework` value) on framework pages to pre-select that framework in
// the create command.
function StartCommandCards({ createFramework }: { createFramework?: string }) {
  return (
    <div className="grid items-stretch gap-3 sm:grid-cols-2">
      {buildCommands(createFramework).map((command) => (
        <CommandCard key={command.id} {...command} />
      ))}
    </div>
  );
}

// "Start the quickstart" — the preserved accent CTA from the pre-cards hero,
// pointed at a framework's quickstart guide. Rendered by the framework landing
// heroes in the action row beneath the command cards; the home hero puts
// <HeroQuickstartDropdown> (same visual treatment, framework picker) in the
// identical slot.
export function QuickstartLinkButton({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="shell-docs-radius-control group inline-flex h-11 w-full items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent-light)] px-4 text-sm font-semibold text-[var(--accent)] no-underline shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-dim)] sm:w-fit"
    >
      Quickstart
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// The full unified hero action block — identical structure on the home hero
// and every framework landing hero (per review: one layout everywhere):
//
//   row 1: the two recommended command cards (create / skills onboard)
//   row 2: the quickstart CTA (dropdown on home, direct link on framework
//          pages) + an optional trailing link
export function HeroStartActions({
  createFramework,
  quickstart,
  trailing,
}: {
  createFramework?: string;
  quickstart: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    // 740px is the narrowest cap where both home commands fit a half-width
    // card on a single line; framework-pinned create commands are longer and
    // wrap to a balanced second line by design.
    <div className="flex max-w-[740px] flex-col gap-4">
      <StartCommandCards createFramework={createFramework} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        {quickstart}
        {trailing}
      </div>
    </div>
  );
}

export function LearnMoreAgentsLink() {
  return (
    <Link
      href="/build-with-agents"
      prefetch={false}
      className="inline-flex items-center gap-1 self-start rounded text-[13px] font-medium text-[var(--accent)] no-underline transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:underline sm:self-auto"
    >
      Learn more about building with agents
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
