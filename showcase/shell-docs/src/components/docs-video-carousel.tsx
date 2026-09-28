"use client";

import { DocsVideoPreview } from "./docs-video-preview";
import { ACCENT_BUTTON_CLASS } from "./wizard-stepper-parts";

import { ArrowRight, Brain, MessagesSquare, Workflow } from "lucide-react";
import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useHomepageTelemetry } from "@/lib/use-homepage-telemetry";

interface Recording {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly loomId: string;
  /** Poster and silent clip share the same first frame. */
  readonly thumbnail: string;
  readonly description: string;
  readonly href: string;
  readonly previewSrc: string;
}

const RECORDINGS: readonly Recording[] = [
  {
    id: "shared-state-harness",
    icon: Workflow,
    title: "Build agent-powered apps",
    description:
      "Connect your agent to your app with interactive UI, shared state, and human approvals.",
    href: "/quickstart",
    previewSrc: "/videos/product-tour/overview.mp4",
    loomId: "5a04db6a04584b79b98021737d012d53",
    thumbnail: "/images/product-tour/overview.jpg",
  },
  {
    id: "rich-threads",
    icon: MessagesSquare,
    title: "Rich Threads",
    description:
      "Persist and resume rich conversations with generative UI, messages, tool activity, and app state. Import existing thread history so users can pick up where they left off.",
    href: "/threads",
    previewSrc: "/videos/product-tour/rich-threads.mp4",
    loomId: "79817778d29e490c97225127d2f17b3a",
    thumbnail: "/images/product-tour/rich-threads.jpg",
  },
  {
    id: "user-memories",
    icon: Brain,
    title: "Automatic Learning",
    description:
      "Turn patterns from real agent conversations into skills you can review and publish. See the learning loop in an expense-review workflow.",
    href: "/learning",
    previewSrc: "/videos/product-tour/automatic-learning.mp4",
    loomId: "2978fbfe42324e509057ac5fd46b7a70",
    thumbnail: "/images/product-tour/automatic-learning.jpg",
  },
] as const;

export function DocsVideoCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const track = useHomepageTelemetry();
  function select(index: number) {
    track("walkthrough_selected", {
      walkthrough: RECORDINGS[index].title,
      loom_id: RECORDINGS[index].loomId,
      tab_id: RECORDINGS[index].id,
      tab_label: index === 0 ? "Overview" : RECORDINGS[index].title,
    });
    setActiveIndex(index);
    tabs.current[index]?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let next = activeIndex;
    if (event.key === "ArrowRight") next = (next + 1) % RECORDINGS.length;
    else if (event.key === "ArrowLeft")
      next = (next + RECORDINGS.length - 1) % RECORDINGS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = RECORDINGS.length - 1;
    else return;
    event.preventDefault();
    if (next !== activeIndex) select(next);
  }
  return (
    <section
      aria-label="Product tour"
      className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[var(--nav-control-border)] bg-[var(--bg-surface)]"
    >
      <div
        role="tablist"
        aria-label="Product tour"
        className="grid grid-cols-3 divide-x divide-[var(--nav-control-border)] border-b border-[var(--nav-control-border)]"
      >
        {RECORDINGS.map((recording, index) => (
          <button
            key={recording.id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`tour-tab-${recording.id}`}
            aria-controls={`tour-panel-${recording.id}`}
            aria-selected={index === activeIndex}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={onKeyDown}
            className={`flex items-center justify-center gap-2 min-h-10 px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${index === activeIndex ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
          >
            <recording.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
            {index === 0 ? "Overview" : recording.title}
          </button>
        ))}
      </div>
      {/* Every panel shares one grid cell, so the card is as tall as its
          longest description and keeps its height when switching tabs. */}
      <div className="grid">
        {RECORDINGS.map((recording, index) => (
          <div
            key={recording.id}
            role="tabpanel"
            id={`tour-panel-${recording.id}`}
            aria-labelledby={`tour-tab-${recording.id}`}
            className={`[grid-area:1/1] ${index === activeIndex ? "" : "invisible"}`}
          >
            <div className="grid min-w-0 h-full content-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:content-center lg:items-center">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">
                  {recording.title}
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-secondary)]">
                  {recording.description}
                </p>
                <a
                  href={recording.href}
                  onClick={() =>
                    track("walkthrough_link_clicked", {
                      walkthrough: recording.title,
                      loom_id: recording.loomId,
                      tab_id: recording.id,
                      tab_label: index === 0 ? "Overview" : recording.title,
                      to_path: recording.href,
                      link_text:
                        index === 0
                          ? "Get started"
                          : `Explore ${recording.title}`,
                    })
                  }
                  className={`mt-5 ${ACCENT_BUTTON_CLASS}`}
                >
                  {index === 0 ? "Get started" : `Explore ${recording.title}`}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </a>
              </div>
              {index === activeIndex && (
                <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--nav-control-border)]">
                  <DocsVideoPreview
                    key={recording.id}
                    title={recording.title}
                    loomId={recording.loomId}
                    poster={recording.thumbnail}
                    previewSrc={recording.previewSrc}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
