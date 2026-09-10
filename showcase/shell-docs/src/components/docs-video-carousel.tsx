// <DocsVideoCarousel> — the homepage's "see it in action" section: a
// heading, a short intro paragraph, and a switcher between three recorded
// product walkthroughs.
//
// Self-contained by design: it takes no props and owns its own list of
// recordings, so `page.tsx` renders a single `<DocsVideoCarousel />` rather
// than assembling the section itself.
//
// The switcher is a real ARIA tab pattern (three named buttons, not
// next/prev arrows — three recordings with meaningful names are better
// chosen directly than cycled through) rather than a generic carousel:
//
//   - `role="tablist"` of `role="tab"` buttons, each `aria-selected` on
//     exactly the active one and `aria-controls` pointing at the panel.
//   - The panel is `role="tabpanel"` with `aria-labelledby` back to the
//     active tab.
//   - Left/Right move between tabs, Home/End jump to the first/last. Only
//     the active tab is in the tab order (roving `tabIndex`), matching the
//     standard tab pattern and what a screen-reader user expects.
//
// Only the active recording's iframe is ever mounted. Three third-party
// Loom players on the homepage would open three sets of connections and
// scripts for two videos nobody asked for yet — mount one, and give it
// `loading="lazy"`. Do NOT "improve" this into rendering all three and
// hiding the inactive ones with CSS.
//
// The switch itself is not animated: the iframe reloads whenever its `src`
// changes, so a slide transition would carry a blank frame across the
// screen mid-animation — worse than a clean swap.

"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface Recording {
  readonly id: string;
  readonly title: string;
  /** One short line of what the recording shows — the title alone is
   *  jargon to a first-time reader. */
  readonly summary: string;
  readonly loomId: string;
}

// Order matches the recordings as produced. "Learning and memory" and
// "Rich threads" are CopilotKit Intelligence features; "Shared state and
// Harness" is core CopilotKit.
const RECORDINGS: readonly Recording[] = [
  {
    id: "shared-state-harness",
    title: "Shared state and Harness",
    summary:
      "An agent updates a live UI directly through shared state, then runs a multi-agent background analysis of company expenses.",
    loomId: "0cad0c3d96e4454c83133a52d9ac8e7b",
  },
  {
    id: "learning-memory",
    title: "Learning and memory",
    summary:
      "An agent recalls past spending patterns and turns a repeated manual approval into a reusable, published skill.",
    loomId: "2978fbfe42324e509057ac5fd46b7a70",
  },
  {
    id: "rich-threads",
    title: "Rich threads",
    summary:
      "Generative UI, uploaded files, and approval cards stay live and in sync as one thread moves across devices.",
    loomId: "79817778d29e490c97225127d2f17b3a",
  },
] as const;

const TAB_ID_PREFIX = "docs-video-tab-";
const PANEL_ID_PREFIX = "docs-video-panel-";

export function DocsVideoCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  // Roving-tabindex focus management (WAI-ARIA tab pattern): moving the
  // selection with the keyboard also moves DOM focus to the newly active
  // tab, so Tab/Shift+Tab always lands on exactly one control.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const active = RECORDINGS[activeIndex];

  function selectAndFocus(index: number) {
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
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text)] sm:text-[1.375rem]">
        See it in action
      </h2>
      <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
        Three recordings show CopilotKit running in a real app: an agent
        updating your UI directly through shared state, plus two things
        CopilotKit Intelligence adds — agents that learn from repeated work, and
        threads that keep generative UI and files in sync across sessions and
        devices.
      </p>

      <div
        role="tablist"
        aria-label="Product walkthrough recordings"
        className="mt-4 flex flex-wrap gap-2"
      >
        {RECORDINGS.map((recording, index) => {
          const isActive = index === activeIndex;
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
              onClick={() => setActiveIndex(index)}
              onKeyDown={handleKeyDown}
              className={`shell-docs-radius-control cursor-pointer border px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none ${
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)]"
              }`}
            >
              {recording.title}
            </button>
          );
        })}
      </div>

      {/* The summary belongs inside the panel, not beside it: it describes
       *  the selected recording and changes with the tab, so a reader who
       *  moves into the panel should find it there rather than have it
       *  orphaned next to the tab strip. */}
      <div
        id={`${PANEL_ID_PREFIX}${active.id}`}
        role="tabpanel"
        aria-labelledby={`${TAB_ID_PREFIX}${active.id}`}
        className="mt-2"
      >
        <p className="text-sm text-[var(--text-secondary)]">{active.summary}</p>

        <div className="not-prose shell-docs-radius-surface mt-3 aspect-[7/4] w-full overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
          <iframe
            src={`https://www.loom.com/embed/${active.loomId}`}
            title={`${active.title} — CopilotKit product walkthrough`}
            className="h-full w-full"
            frameBorder="0"
            allowFullScreen
            // Matches the sandbox this app already grants a video embed (see
            // the YouTube iframe in mdx-registry.tsx): scripts and
            // same-origin for the player itself, presentation for
            // fullscreen, popups for its share/login links.
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}
