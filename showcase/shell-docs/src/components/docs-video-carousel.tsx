"use client";

import { DocsVideoPreview } from "./docs-video-preview";

import { useHomepageTelemetry } from "@/lib/use-homepage-telemetry";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Brain, MessagesSquare, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Recording {
  readonly id: string;
  readonly title: string;
  readonly loomId: string;
  readonly icon: LucideIcon;
  readonly thumbnail: string;
  readonly previewSrc: string;
}

const RECORDINGS: readonly Recording[] = [
  {
    id: "shared-state-harness",
    title: "Overview",
    loomId: "5a04db6a04584b79b98021737d012d53",
    previewSrc:
      "https://cdn.loom.com/sessions/thumbnails/5a04db6a04584b79b98021737d012d53-df1797187f8ba377.mp4",
    icon: Workflow,
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/5a04db6a04584b79b98021737d012d53-df1797187f8ba377.jpg",
  },
  {
    id: "user-memories",
    title: "Automatic Learning",
    loomId: "2978fbfe42324e509057ac5fd46b7a70",
    previewSrc:
      "https://cdn.loom.com/sessions/thumbnails/2978fbfe42324e509057ac5fd46b7a70-37108be11ee154e6.mp4",
    icon: Brain,
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/2978fbfe42324e509057ac5fd46b7a70-37108be11ee154e6.jpg",
  },
  {
    id: "rich-threads",
    title: "Rich Threads",
    loomId: "79817778d29e490c97225127d2f17b3a",
    previewSrc:
      "https://cdn.loom.com/sessions/thumbnails/79817778d29e490c97225127d2f17b3a-ca44156ad449b63b.mp4",
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
        <DocsVideoPreview
          key={active.id}
          title={active.title}
          loomId={active.loomId}
          poster={active.thumbnail}
          previewSrc={active.previewSrc}
        />
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
              className={`shell-docs-radius-control inline-flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium leading-tight sm:flex-row sm:gap-2 sm:px-2 sm:text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] focus-visible:outline-none ${isActive ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"}`}
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
