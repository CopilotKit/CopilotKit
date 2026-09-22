"use client";

import { useHomepageTelemetry } from "@/lib/use-homepage-telemetry";

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
  readonly thumbnail: string;
}

const RECORDINGS: readonly Recording[] = [
  {
    id: "shared-state-harness",
    title: "Overview",
    loomId: "5a04db6a04584b79b98021737d012d53",
    icon: Workflow,
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/5a04db6a04584b79b98021737d012d53-df1797187f8ba377.jpg",
  },
  {
    id: "user-memories",
    title: "Automatic Learning",
    loomId: "2978fbfe42324e509057ac5fd46b7a70",
    icon: Brain,
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/2978fbfe42324e509057ac5fd46b7a70-37108be11ee154e6.jpg",
  },
  {
    id: "rich-threads",
    title: "Rich Threads",
    loomId: "79817778d29e490c97225127d2f17b3a",
    icon: MessagesSquare,
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/79817778d29e490c97225127d2f17b3a-250a43d55abed071.jpg",
  },
] as const;

const TAB_ID_PREFIX = "docs-video-tab-";
const PANEL_ID_PREFIX = "docs-video-panel-";

export function DocsVideoCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const track = useHomepageTelemetry();
  const [playing, setPlaying] = useState(false);
  // Roving-tabindex focus management (WAI-ARIA tab pattern): moving the
  // selection with the keyboard also moves DOM focus to the newly active
  // tab, so Tab/Shift+Tab always lands on exactly one control.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const active = RECORDINGS[activeIndex];

  function selectAndFocus(index: number) {
    if (index !== activeIndex)
      track("walkthrough_selected", {
        walkthrough: RECORDINGS[index].title,
        loom_id: RECORDINGS[index].loomId,
      });
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
    <section
      aria-label="Product walkthroughs"
      className="overflow-hidden rounded-xl border border-[var(--nav-control-border)] bg-[var(--bg-surface)]"
    >
      <div
        id={`${PANEL_ID_PREFIX}${active.id}`}
        role="tabpanel"
        aria-labelledby={`${TAB_ID_PREFIX}${active.id}`}
        className="relative"
      >
        <div className="not-prose h-[520px] w-full overflow-hidden bg-[var(--bg-elevated)] sm:h-[600px]">
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
              onClick={() => {
                track("video_play_clicked", {
                  walkthrough: active.title,
                  loom_id: active.loomId,
                });
                setPlaying(true);
              }}
              aria-label={`Play ${active.title} walkthrough`}
              className="group relative flex h-full w-full cursor-pointer items-center justify-center overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--accent)]"
            >
              <img
                key={active.thumbnail}
                src={active.thumbnail}
                onError={(event) => {
                  event.currentTarget.style.visibility = "hidden";
                }}
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
        {playing && (
          <a
            href={`https://www.loom.com/share/${active.loomId}`}
            target="_blank"
            rel="noreferrer"
            className="absolute right-3 top-3 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text)] shadow-sm hover:text-[var(--accent)]"
          >
            Open on Loom{" "}
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <div
        role="tablist"
        aria-label="Product walkthrough recordings"
        className="grid grid-cols-3 gap-1 border-t border-[var(--nav-control-border)] p-1.5"
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
              className={`shell-docs-radius-pill inline-flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium leading-tight sm:flex-row sm:gap-2 sm:px-2 sm:text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] focus-visible:outline-none ${isActive ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"}`}
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span data-testid="tab-title" className="whitespace-nowrap">
                {recording.title}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
