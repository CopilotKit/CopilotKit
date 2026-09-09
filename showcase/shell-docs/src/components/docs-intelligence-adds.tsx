// DocsIntelligenceAdds — section 3 of the docs homepage, "What Intelligence
// adds in production".
//
// The section answers one question: the reader already knows what CopilotKit
// does, so what does the platform change? It reads top to bottom as layer
// diagram → the sentence that names the boundary → the four before/after
// pairs → where Intelligence sits → the shortcut for readers who already run
// CopilotKit. That shortcut is a link, not a copy button; see the comment at
// the bottom of the component for why.
//
// The layer diagram arrives as a slot rather than an import, following
// `HeroStartActions` in `./hero-start-commands`: this component owns the
// order, spacing and copy of the section, and the caller supplies the picture.

import React from "react";
import Link from "next/link";

// House inline-link treatment, matching `channels-activation-strip`.
const TERM_LINK_CLASS =
  "font-semibold text-[var(--accent)] underline decoration-[var(--accent)]/30 underline-offset-4 transition-colors hover:decoration-[var(--accent)]";

interface IntelligencePair {
  /** The state of the world with the open-source runtime alone. */
  without: string;
  /** The same state once Intelligence is connected, with its docs link. */
  with: React.ReactNode;
}

// Every destination link lives in the "With Intelligence" half — the
// "Without Intelligence" half describes a state, not a place to go. The first
// pair has no single bolded term to hang the link on, so its whole sentence
// carries the Threads link; the other three link the named capability.
const PAIRS: IntelligencePair[] = [
  {
    without: "Threads live in the session",
    with: (
      <Link href="/threads" className={TERM_LINK_CLASS}>
        They survive reloads, devices, and sessions
      </Link>
    ),
  },
  {
    without: "The agent knows the current conversation",
    with: (
      <>
        <Link href="/intelligence/memories" className={TERM_LINK_CLASS}>
          Memory
        </Link>
        {" — durable facts across conversations"}
      </>
    ),
  },
  {
    without: "Usage happens and disappears",
    with: (
      <>
        <Link href="/learning" className={TERM_LINK_CLASS}>
          Learning
        </Link>
        {" — completed threads become reviewed Skills"}
      </>
    ),
  },
  {
    without: "You debug from logs",
    with: (
      <>
        <Link href="/inspector" className={TERM_LINK_CLASS}>
          Inspector and analytics
        </Link>
        {" over real runs"}
      </>
    ),
  },
];

const LABEL_CLASS =
  "text-[11px] font-semibold uppercase leading-relaxed tracking-wide";

export function DocsIntelligenceAdds({
  diagram,
}: {
  diagram: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      id="intelligence"
      aria-labelledby="docs-intelligence-adds-heading"
      className="not-prose"
    >
      <div className="max-w-2xl">
        <h2
          id="docs-intelligence-adds-heading"
          className="text-xl font-semibold tracking-tight text-[var(--text)] sm:text-2xl"
        >
          What Intelligence adds in production
        </h2>
      </div>

      <div className="mt-5">{diagram}</div>

      <p className="mt-5 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
        {/* Deliberately names the label, not a position. The first draft read
            "Everything to the right of that line…", which is false below the
            `sm` breakpoint: the diagram stacks there, so nothing is to the
            right and there is no line. Referring to the box's own label is
            true at every width. */}
        That platform layer is what Intelligence adds. Here is what it changes:
      </p>

      {/*
        Markup choice: a definition list, not a `<table>`. These are four
        independent name/value groups, which is exactly what a `<dl>` is for,
        and — unlike a table — the label travels with its own value instead of
        living in a column header. A stacked `<table>` at 375px needs
        `display: block` overrides that break the header/cell association for
        sighted readers, or duplicated `::before` labels to restore it.

        Stacking: each pair is one card. From `sm` up the card is a two-column
        grid filled column-first (`sm:grid-flow-col`), so the "without" half
        sits left and the "with" half right. At 375px `grid-cols-1` takes over
        and the four cells stack in source order — label, without-state, label,
        with-state — so the reader always sees which half is which, at any
        width and in a screen reader alike. Nothing has a fixed width, so the
        section never scrolls horizontally.
      */}
      <dl className="mt-4 grid grid-cols-1 gap-2.5 sm:gap-3">
        {PAIRS.map((pair) => (
          <div
            key={pair.without}
            className="shell-docs-radius-surface grid grid-cols-1 gap-x-6 gap-y-1 border border-[var(--border)] bg-[var(--bg-elevated)]/30 p-3.5 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-[auto_1fr]"
          >
            <dt className={`${LABEL_CLASS} text-[var(--text-muted)]`}>
              Without Intelligence
            </dt>
            <dd className="m-0 break-words text-sm leading-relaxed text-[var(--text-secondary)]">
              {pair.without}
            </dd>
            <dt className={`${LABEL_CLASS} mt-2 text-[var(--accent)] sm:mt-0`}>
              With Intelligence
            </dt>
            <dd className="m-0 break-words text-sm leading-relaxed text-[var(--text)]">
              {pair.with}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
        Intelligence is the platform your runtime talks to — hosted by us, or
        running in your own cluster.
      </p>

      {/* A link, deliberately not a copy button. The spec originally put
          <RichThreadsSetupPrompt /> here, but that made three clipboard
          buttons on one page — the hero's prompt, this one, and the Start
          section's — and a reader cannot tell at a glance which prompt is
          which. Consolidating those affordances is the point of the ticket,
          so the shortcut points at the quickstart, which already renders
          that exact prompt with the surrounding context it needs. */}
      <p className="mt-5 text-sm leading-relaxed text-[var(--text-secondary)]">
        <Link
          href="/intelligence/quickstart"
          className="font-medium text-[var(--accent)] underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--accent)]"
        >
          Already running CopilotKit? Connect Intelligence in five minutes
        </Link>
      </p>
    </section>
  );
}
