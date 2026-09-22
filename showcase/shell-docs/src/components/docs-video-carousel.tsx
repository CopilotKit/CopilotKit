"use client";

import { DocsVideoPreview } from "./docs-video-preview";

import { ArrowUpRight } from "lucide-react";

interface Recording {
  readonly id: string;
  readonly title: string;
  readonly loomId: string;
  readonly thumbnail: string;
  readonly description: string;
  readonly href?: string;
  readonly previewSrc: string;
}

const RECORDINGS: readonly Recording[] = [
  {
    id: "shared-state-harness",
    title: "See CopilotKit in action",
    description:
      "Connect your agent to your app with interactive UI, shared state, and human approvals.",
    previewSrc:
      "https://cdn.loom.com/sessions/thumbnails/5a04db6a04584b79b98021737d012d53-df1797187f8ba377.mp4",
    loomId: "5a04db6a04584b79b98021737d012d53",
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/5a04db6a04584b79b98021737d012d53-df1797187f8ba377.jpg",
  },
  {
    id: "user-memories",
    title: "Automatic Learning",
    description:
      "Turn patterns from real agent conversations into skills you can review and publish. See the learning loop in an expense-review workflow.",
    href: "/learning",
    previewSrc:
      "https://cdn.loom.com/sessions/thumbnails/2978fbfe42324e509057ac5fd46b7a70-37108be11ee154e6.mp4",
    loomId: "2978fbfe42324e509057ac5fd46b7a70",
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/2978fbfe42324e509057ac5fd46b7a70-37108be11ee154e6.jpg",
  },
  {
    id: "rich-threads",
    title: "Rich Threads",
    description:
      "Save and restore conversations across sessions and devices, including messages, tool results, and app state.",
    href: "/threads",
    previewSrc:
      "https://cdn.loom.com/sessions/thumbnails/79817778d29e490c97225127d2f17b3a-ca44156ad449b63b.mp4",
    loomId: "79817778d29e490c97225127d2f17b3a",
    thumbnail:
      "https://cdn.loom.com/sessions/thumbnails/79817778d29e490c97225127d2f17b3a-250a43d55abed071.jpg",
  },
] as const;

export function DocsVideoCarousel() {
  return (
    <div className="space-y-12 sm:space-y-14">
      {RECORDINGS.map((recording) => (
        <section key={recording.id} aria-labelledby={`${recording.id}-heading`}>
          <div className="mb-5">
            <h2
              id={`${recording.id}-heading`}
              className="text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] text-[var(--text)] sm:text-[2rem]"
            >
              {recording.title}
            </h2>
            <p className="mt-3 max-w-[65ch] text-base leading-relaxed text-[var(--text-secondary)]">
              {recording.description}
            </p>
            {recording.href && (
              <a
                href={recording.href}
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:underline"
              >
                Explore {recording.title}
                <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
              </a>
            )}
          </div>
          <DocsVideoPreview
            title={recording.title}
            loomId={recording.loomId}
            poster={recording.thumbnail}
            previewSrc={recording.previewSrc}
          />
        </section>
      ))}
    </div>
  );
}
