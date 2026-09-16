"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowUpRight,
  Brain,
  MessagesSquare,
  Play,
  Workflow,
  MousePointer2,
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
    title: "Shared state",
    loomId: "0cad0c3d96e4454c83133a52d9ac8e7b",
    icon: Workflow,
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/0cad0c3d96e4454c83133a52d9ac8e7b-3b470279be27260d.jpg",
  },
  {
    id: "user-memories",
    title: "User Memories",
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

const LIVE_DEMO_URL =
  "https://showcase-langgraph-python-production.up.railway.app/demos/gen-ui-tool-based";
const TABS = [
  { id: "live-demo", title: "Demo", icon: MousePointer2 },
  ...RECORDINGS,
];

const TAB_ID_PREFIX = "docs-video-tab-";
const PANEL_ID_PREFIX = "docs-video-panel-";

export function DocsVideoCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Roving-tabindex focus management (WAI-ARIA tab pattern): moving the
  // selection with the keyboard also moves DOM focus to the newly active
  // tab, so Tab/Shift+Tab always lands on exactly one control.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const active = RECORDINGS[activeIndex - 1];
  const activeTab = TABS[activeIndex];
  const isLiveDemo = activeIndex === 0;

  function selectAndFocus(index: number) {
    setPlaying(false);
    setActiveIndex(index);
    tabRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        selectAndFocus((activeIndex + 1) % TABS.length);
        break;
      case "ArrowLeft":
        event.preventDefault();
        selectAndFocus((activeIndex - 1 + TABS.length) % TABS.length);
        break;
      case "Home":
        event.preventDefault();
        selectAndFocus(0);
        break;
      case "End":
        event.preventDefault();
        selectAndFocus(TABS.length - 1);
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
        id={`${PANEL_ID_PREFIX}${activeTab.id}`}
        role="tabpanel"
        aria-labelledby={`${TAB_ID_PREFIX}${activeTab.id}`}
        className="relative"
      >
        <div
          className={`not-prose w-full overflow-hidden bg-[var(--bg-elevated)] ${isLiveDemo ? "h-[560px] sm:h-[640px]" : "aspect-video"}`}
        >
          {isLiveDemo ? (
            <iframe
              src={LIVE_DEMO_URL}
              title="Demo: LangGraph generative UI"
              className="h-full w-full border-0"
            />
          ) : playing ? (
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
        {!isLiveDemo && playing && (
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
        className="grid grid-cols-4 gap-1 border-t border-[var(--nav-control-border)] p-1.5"
      >
        {TABS.map((recording, index) => {
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
