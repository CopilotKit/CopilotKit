"use client";

// <HeroStartActions> — the docs hero's primary call-to-action, shared verbatim
// by the home hero and the framework landing heroes so both surfaces read
// identically. It keeps the hero focused on the guided Quickstart path, while
// making CLI setup available as an optional reveal for users who already know
// they want terminal commands:
//
//   • "Start a new project"        → npx copilotkit@latest create
//   • "Add to an existing project" → npx copilotkit@latest skills onboard
//   • Quickstart                   → guided docs walkthrough
//
// Commands live in a compact popover menu anchored to the CLI button, not as
// hero content. Each row is a single copy button with an `aria-live` status
// sibling so the copy result is announced to assistive tech. Clipboard failures
// (insecure context, sandboxed iframe, permissions policy, in-app webview,
// older browsers) fall back to the older selection API before reporting a
// screen-reader-only failure state.

import React from "react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { ArrowRight, ChevronDown } from "lucide-react";

type CopyState = "idle" | "copied" | "error";

type StartCommand = {
  id: string;
  label: string;
  description: string;
  command: string;
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
      label: "Start from scratch",
      description: "Start in 5 minutes with one of our curated starters",
      command: createCommand,
    },
    {
      id: "onboard",
      label: "Use your existing agent",
      description:
        "Start using your agent harness of choice with CopilotKit skills",
      command: "npx copilotkit@latest skills onboard",
    },
  ];
}

async function copyCommandText(command: string) {
  try {
    await navigator.clipboard.writeText(command);
    return { copied: true, clipboardBlocked: false };
  } catch {
    // Some embedded browsers block the async Clipboard API even on localhost.
    // Use the older selection path before surfacing failure to the user.
  }

  if (typeof document === "undefined") {
    return { copied: false, clipboardBlocked: true };
  }

  const textarea = document.createElement("textarea");
  textarea.value = command;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, command.length);

  try {
    const copied = document.execCommand("copy");
    return { copied, clipboardBlocked: true };
  } finally {
    textarea.remove();
  }
}

function CommandMenuItem({ id, label, description, command }: StartCommand) {
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
    const result = await copyCommandText(command);
    if (result.copied) {
      setCopyState("copied");
      trackHeroCopy(result.clipboardBlocked);
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1500);
    } else {
      console.warn("[hero-start-commands] clipboard write failed");
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
    <div className="min-w-0 px-3.5 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold leading-snug text-[var(--text)]">
          {label}
        </div>
        <div className="mt-0.5 max-w-[42ch] text-xs leading-snug text-[var(--text-muted)]">
          {description}
        </div>
      </div>

      <button
        type="button"
        onClick={onCopy}
        aria-label={copyAriaLabel}
        className={`shell-docs-radius-control group mt-3 flex w-full cursor-pointer items-start gap-3 border px-3 py-2.5 text-left shadow-[var(--shadow-control)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          errored
            ? "border-[var(--border)] bg-[var(--bg-elevated)]"
            : copied
              ? "border-[var(--accent)] bg-[var(--accent-dim)]"
              : "border-[color-mix(in_oklch,var(--accent)_22%,var(--border))] bg-[var(--bg-elevated)] hover:border-[var(--accent)] hover:bg-[var(--accent-dim)]"
        }`}
      >
        {/* Long commands wrap at spaces only — each token is non-breaking so
            a flag like `--framework` can never split mid-token. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 font-mono text-[12.5px] font-semibold leading-[1.45] text-[var(--text)]">
          <span aria-hidden="true" className="select-none text-[var(--accent)]">
            $
          </span>
          {command.split(" ").map((token, i) => (
            <span key={`${token}-${i}`} className="whitespace-nowrap">
              {token}
            </span>
          ))}
        </span>
        <span
          aria-hidden="true"
          className={`shrink-0 pt-0.5 font-sans text-[11px] font-semibold transition-colors ${
            errored
              ? "text-[var(--text-faint)]"
              : copied
                ? "text-[var(--accent)]"
                : "text-[var(--text-muted)] group-hover:text-[var(--accent)]"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </span>
      </button>

      <span aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}

function CommandMenu({
  createFramework,
  trailing,
}: {
  createFramework?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="divide-y divide-[var(--border)]">
      {buildCommands(createFramework).map((command) => (
        <CommandMenuItem key={command.id} {...command} />
      ))}
      {trailing ? <div className="py-1.5">{trailing}</div> : null}
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
      className="shell-docs-primary-cta shell-docs-radius-control group inline-flex h-11 w-full items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] no-underline shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] sm:w-fit"
    >
      Quickstart
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function HeroStartActions({
  createFramework,
  quickstart,
  trailing,
}: {
  createFramework?: string;
  quickstart: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const [showCli, setShowCli] = React.useState(false);
  const cliMenuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!showCli) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || cliMenuRef.current?.contains(target)) return;
      setShowCli(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowCli(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showCli]);

  return (
    <div className="flex max-w-[820px] flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {quickstart}
        <div ref={cliMenuRef} className="relative w-full sm:w-fit">
          <button
            type="button"
            aria-expanded={showCli}
            aria-controls="hero-cli-commands"
            onClick={() => setShowCli((value) => !value)}
            className="shell-docs-radius-control inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-4 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:w-fit"
          >
            Start using agents
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${showCli ? "rotate-180" : ""}`}
            />
          </button>
          {showCli ? (
            <div
              id="hero-cli-commands"
              className="shell-docs-radius-surface absolute left-0 top-[calc(100%+8px)] z-30 w-full min-w-0 overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)] sm:w-[440px]"
            >
              <CommandMenu
                createFramework={createFramework}
                trailing={trailing}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LearnMoreAgentsLink() {
  return (
    <Link
      href="/build-with-agents"
      prefetch={false}
      className="block px-3.5 py-3 no-underline transition-colors hover:bg-[var(--accent-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <span className="block text-[13px] font-semibold leading-snug text-[var(--text)]">
        Build with agents
      </span>
      <span className="mt-0.5 block text-xs leading-snug text-[var(--text-muted)]">
        Explore agent backends and framework options
      </span>
    </Link>
  );
}
