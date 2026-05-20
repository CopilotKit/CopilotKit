"use client";

// PageActions — quick "Copy Markdown" + "Open in <LLM>" affordance rendered
// between the doc title/description and the first body section.
//
// Fumadocs's `@fumadocs/ui` package describes a similar built-in
// `PageActions` / `LLMCopyButton` in their docs at
// https://www.fumadocs.dev/docs/integrations/llms#page-actions, but those
// components are not exported from the 15.x npm package — they live in
// Fumadocs's own docs site source. This is a from-scratch equivalent so
// shell-docs gets the same surface without an upstream upgrade.
//
// Why this lives here (client) and not in `docs-page-view.tsx` (server):
// the copy button needs `navigator.clipboard.writeText`, the dropdown
// needs `useState` for open/close, and the LLM URLs need
// `window.location.href` to embed the current page in the prompt. All
// three are browser-only. The server component passes the raw MDX
// source and a pre-computed GitHub link in via props.

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Github,
  MessageCircle,
  Sparkles,
} from "lucide-react";

export interface PageActionsProps {
  /** Raw MDX source — what "Copy Markdown" writes to the clipboard. */
  source: string;
  /** Pre-computed link to the source file on GitHub. */
  githubUrl: string;
}

interface OpenInOption {
  label: string;
  baseUrl: string;
  /** Query-string key the provider uses to receive a pre-filled prompt. */
  promptParam: string;
  icon: React.ReactNode;
}

// Each provider accepts a different query-string key for the pre-filled
// prompt; the LLM is asked to read the current page URL and answer
// questions about it. Anchors are dropped from the page URL so the
// LLM crawls the whole document rather than a specific section.
const OPEN_IN_OPTIONS: OpenInOption[] = [
  {
    label: "Open in ChatGPT",
    baseUrl: "https://chatgpt.com/",
    promptParam: "q",
    icon: <Sparkles className="h-4 w-4" aria-hidden />,
  },
  {
    label: "Open in Claude",
    baseUrl: "https://claude.ai/new",
    promptParam: "q",
    icon: <Bot className="h-4 w-4" aria-hidden />,
  },
  {
    label: "Open in T3 Chat",
    baseUrl: "https://t3.chat/new",
    promptParam: "q",
    icon: <MessageCircle className="h-4 w-4" aria-hidden />,
  },
];

export function PageActions({ source, githubUrl }: PageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close the dropdown on outside click / Escape so it behaves like a
  // native menu. Listener is only mounted while open to avoid noise.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Clear any pending "copied → idle" timer on unmount so we don't call
  // setState on an unmounted component if the user navigates away during
  // the 2s window.
  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // navigator.clipboard rejects on http://, on unfocused tabs, and
      // when the user has denied clipboard permission. Don't flip the
      // success indicator — the user pastes whatever stale buffer they
      // had and is misled. Log loudly instead.
      console.error(
        "[page-actions] clipboard write failed; copy button no-op",
        err,
      );
    }
  };

  const buildLlmUrl = (option: OpenInOption): string => {
    // window.location is available because this is a client component
    // and the handler only fires on user interaction (post-hydration).
    // Strip the fragment so the LLM sees the entire page, not just the
    // currently-focused section.
    const pageUrl = window.location.href.split("#")[0];
    const prompt = `Read the CopilotKit documentation page at ${pageUrl} and help me with my questions about it.`;
    return `${option.baseUrl}?${option.promptParam}=${encodeURIComponent(prompt)}`;
  };

  return (
    <div className="flex items-center gap-2 my-6">
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label={copied ? "Page Markdown copied" : "Copy page as Markdown"}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
        <span>{copied ? "Copied" : "Copy Markdown"}</span>
      </button>

      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <span>Open</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </button>
        {open && (
          <div
            role="menu"
            aria-label="Open this page in"
            className="absolute left-0 top-[calc(100%+4px)] z-10 min-w-[220px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
          >
            <MenuItem
              href={githubUrl}
              icon={<Github className="h-4 w-4" aria-hidden />}
              label="Open in GitHub"
              onSelect={() => setOpen(false)}
            />
            {OPEN_IN_OPTIONS.map((opt) => (
              <MenuItem
                key={opt.label}
                href={buildLlmUrl(opt)}
                icon={opt.icon}
                label={opt.label}
                onSelect={() => setOpen(false)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface MenuItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}

function MenuItem({ href, icon, label, onSelect }: MenuItemProps) {
  return (
    <a
      role="menuitem"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onSelect}
      className="flex items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--surface-hover)]"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <ExternalLink className="h-3 w-3 text-[var(--text-muted)]" aria-hidden />
    </a>
  );
}
