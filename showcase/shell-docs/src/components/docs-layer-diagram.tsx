// DocsLayerDiagram — the layer diagram for the homepage section
// "What Intelligence adds in production".
//
// It is deliberately markup rather than an image: dark mode comes for free
// from the design tokens, the labels stay selectable and searchable, and a
// screen reader can read the whole thing linearly. An exported PNG would rot
// silently the way `public/images/ai-protocol-stack.png` did.
//
// The component is a server component on purpose — it has no interactivity,
// so there is no `"use client"` here.

import React from "react";

type Layer = {
  name: string;
  body: string;
  // Which side of the boundary this layer sits on. Rendered as the bracket
  // row on wide viewports, and as a per-box eyebrow once the row collapses.
  side: string;
  emphasised?: boolean;
};

const LAYERS: Layer[] = [
  {
    name: "Frontend",
    body: "Your app — chat, generative UI, tools.",
    side: "runs on your side",
  },
  {
    name: "Runtime",
    body: "Your server — the bridge.",
    side: "runs on your side",
    // The runtime is the layer both halves of the diagram meet at, and the
    // one Intelligence actually attaches to, so it carries the 2px border.
    emphasised: true,
  },
  {
    name: "Intelligence",
    body: "Hosted by us, or in your own cluster.",
    side: "the platform",
  },
];

// Five illustrative names and no count. The original draft said "12 more",
// which was already wrong — the registry has 19 visible entries. But the
// right number is not 14 either: the registry counts *integrations*, not
// frameworks, so LangGraph appears three times (Python, TypeScript, FastAPI)
// and Microsoft Agent Framework three times as well. Any number here is
// either inaccurate or needs a footnote. This diagram only has to say that
// your own framework attaches at the runtime; the grid in <DocsLandingNext>
// is the inventory, and it counts what it actually renders.
const AGENT_FRAMEWORKS = "LangGraph · Mastra · Agno · CrewAI · ADK · and more";

const BOX_BASE_CLASS =
  "shell-docs-radius-surface flex min-w-0 flex-col gap-1 p-3.5";

const EYEBROW_CLASS =
  "text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]";

// The bracket row only makes sense while the three boxes sit side by side. It
// spans two columns, and a two-column span has nothing to describe once the
// row becomes a single stacked column. So below `sm` the bracket row is
// dropped and each box carries its own side label instead — same information,
// no horizontal overflow at 375px.
function BracketRow() {
  return (
    <div className="mb-2 hidden grid-cols-3 gap-3 sm:grid">
      <div className="col-span-2 min-w-0">
        <div className={EYEBROW_CLASS}>runs on your side</div>
        <div className="mt-1 h-1.5 border-l border-r border-t border-[var(--border)]" />
      </div>
      <div className="col-span-1 min-w-0">
        <div className={EYEBROW_CLASS}>the platform</div>
        <div className="mt-1 h-1.5 border-l border-r border-t border-[var(--border)]" />
      </div>
    </div>
  );
}

// A short vertical rule plus the protocol name, sitting between the layer row
// and the agent box. Purely decorative geometry stays `aria-hidden`; the
// "AG-UI" label itself is real text so it is read, searched and selected.
function AgUiConnector() {
  return (
    <div className="flex flex-col items-center py-1">
      <span aria-hidden="true" className="h-4 w-px bg-[var(--border)]" />
      <span className="shell-docs-radius-icon border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
        AG-UI
      </span>
      <span aria-hidden="true" className="h-4 w-px bg-[var(--border)]" />
    </div>
  );
}

export function DocsLayerDiagram() {
  return (
    <figure className="not-prose m-0">
      <figcaption className="sr-only">
        How the layers fit together: your frontend and your runtime run on your
        side, CopilotKit Intelligence is the platform your runtime talks to, and
        your own agent connects to the runtime over AG-UI.
      </figcaption>

      <BracketRow />

      <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
        {LAYERS.map((layer) => (
          <li
            key={layer.name}
            className={
              layer.emphasised
                ? `${BOX_BASE_CLASS} border-2 border-[var(--accent)] bg-[var(--accent-dim)]`
                : `${BOX_BASE_CLASS} border border-[var(--border)] bg-[var(--bg-elevated)]/30`
            }
          >
            {/* Only visible while the bracket row above is hidden, so the
                side label is never announced twice at the same width. */}
            <span className={`${EYEBROW_CLASS} sm:hidden`}>{layer.side}</span>
            <span className="text-sm font-semibold leading-snug text-[var(--text)]">
              {layer.name}
            </span>
            <span className="text-xs leading-relaxed text-[var(--text-muted)]">
              {layer.body}
            </span>
          </li>
        ))}
      </ul>

      <AgUiConnector />

      <div className="shell-docs-radius-surface border border-dashed border-[var(--border)] bg-[var(--bg-surface)] p-3.5 text-center">
        <div className="text-sm font-semibold leading-snug text-[var(--text)]">
          Your agent
        </div>
        <div className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
          {AGENT_FRAMEWORKS}
        </div>
      </div>
    </figure>
  );
}
