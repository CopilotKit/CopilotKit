"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowUpRight,
  Brain,
  MessagesSquare,
  Play,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Recording {
  readonly id: string;
  readonly title: string;
  readonly loomId: string;
  readonly icon: LucideIcon;
  readonly description: string;
  readonly thumbnail: string;
}

const RECORDINGS: readonly Recording[] = [
  {
    id: "shared-state-harness",
    title: "Shared state",
    loomId: "0cad0c3d96e4454c83133a52d9ac8e7b",
    icon: Workflow,
    description:
      "Ask your agent to review expenses, flag transactions, and update the app as it works.",
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/0cad0c3d96e4454c83133a52d9ac8e7b-3b470279be27260d.gif",
  },
  {
    id: "user-memories",
    title: "User Memories",
    loomId: "2978fbfe42324e509057ac5fd46b7a70",
    icon: Brain,
    description:
      "Remember a user's preferences and reuse what the agent learns across conversations.",
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/2978fbfe42324e509057ac5fd46b7a70-37108be11ee154e6.gif",
  },
  {
    id: "rich-threads",
    title: "Rich Threads",
    loomId: "79817778d29e490c97225127d2f17b3a",
    icon: MessagesSquare,
    description:
      "Keep interactive charts, files, and approval cards in conversations users can return to.",
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/79817778d29e490c97225127d2f17b3a-250a43d55abed071.jpg",
  },
] as const;

const TAB_ID_PREFIX = "docs-video-tab-";
const PANEL_ID_PREFIX = "docs-video-panel-";

export function DocsVideoCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Roving-tabindex focus management (WAI-ARIA tab pattern): moving the
  // selection with the keyboard also moves DOM focus to the newly active
  // tab, so Tab/Shift+Tab always lands on exactly one control.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const active = RECORDINGS[activeIndex];

  function selectAndFocus(index: number) {
    setPlaying(false);
    setActiveIndex(index);
    tabRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        selectAndFocus((activeIndex + 1) % RECORDINGS.length);
        break;
      case "ArrowLeft":
        event.preventDefault();
        selectAndFocus(
          (activeIndex - 1 + RECORDINGS.length) % RECORDINGS.length,
        );
        break;
      case "Home":
        event.preventDefault();
        selectAndFocus(0);
        break;
      case "End":
        event.preventDefault();
        selectAndFocus(RECORDINGS.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <section aria-labelledby="walkthrough-heading" className="pb-12 sm:pb-16">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2
          id="walkthrough-heading"
          className="text-sm font-semibold text-[var(--text)]"
        >
          See it in action
        </h2>
        <div
          role="tablist"
          aria-label="Product walkthrough recordings"
          className="flex flex-wrap gap-1"
        >
          {RECORDINGS.map((recording, index) => {
            const isActive = index === activeIndex;
            const Icon = recording.icon;
            return (
              <button
                key={recording.id}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                type="button"
                role="tab"
                id={`${TAB_ID_PREFIX}${recording.id}`}
                aria-selected={isActive}
                aria-controls={`${PANEL_ID_PREFIX}${recording.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectAndFocus(index)}
                onKeyDown={handleKeyDown}
                className={`shell-docs-radius-control inline-flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none ${
                  isActive
                    ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
                }`}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span data-testid="tab-title">{recording.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={`${PANEL_ID_PREFIX}${active.id}`}
        role="tabpanel"
        aria-labelledby={`${TAB_ID_PREFIX}${active.id}`}
      >
        <div className="not-prose aspect-video w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-sm">
          {playing ? (
            <iframe
              src={`https://www.loom.com/embed/${active.loomId}?autoplay=1`}
              title={`${active.title}: CopilotKit product walkthrough`}
              className="h-full w-full"
              allow="autoplay; fullscreen"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={`Play ${active.title} walkthrough`}
              className="group relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--accent)]"
            >
              <img
                src={active.thumbnail}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <span className="relative inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-control)] transition-colors group-hover:text-[var(--accent)]">
                <Play aria-hidden="true" className="h-4 w-4" />
                Watch walkthrough
              </span>
            </button>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <p className="max-w-[60ch] text-sm leading-relaxed text-[var(--text-secondary)]">
            {active.description}
            {active.id !== "shared-state-harness" && (
              <span className="mt-1 block text-xs text-[var(--text-muted)]">
                Available with CopilotKit Intelligence.
              </span>
            )}
          </p>
          <a
            href={`https://www.loom.com/share/${active.loomId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-6 shrink-0 items-center gap-1 text-xs text-[var(--text-muted)] underline underline-offset-4 hover:text-[var(--accent)]"
          >
            Watch on Loom
            <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
          </a>
        </div>
      </div>
    </section>
  );
}
