"use client";

/**
 * /components/enrichment-review.tsx
 *
 * Visual design review surface for the EnrichmentStream component family.
 * Renders every state of:
 *
 *   - EnrichmentCell (idle / inflight / summarized / scored×tiers / error)
 *   - EnrichmentDetailCard (popover form, all states)
 *   - EnrichmentStream (sheet, 5 lifecycle snapshots)
 *   - EnrichmentPill (active / complete / complete-with-errors)
 *
 * Plus the supporting state-shape and CopilotKit registration code so the
 * reviewer can see the wiring without leaving the page.
 *
 * The legacy bento grid below this section is left untouched.
 */

import { EnrichmentCell } from "@/components/leads/enrichment/EnrichmentCell";
import { EnrichmentDetailCard } from "@/components/leads/enrichment/EnrichmentDetailCard";
import { EnrichmentPill } from "@/components/leads/enrichment/EnrichmentPill";
import { EnrichmentStream } from "@/components/leads/enrichment/EnrichmentStream";
import {
  MOCK_LEADS_52,
  SNAPSHOT_COMPLETE,
  SNAPSHOT_COMPLETE_WITH_ERRORS,
  SNAPSHOT_EARLY,
  SNAPSHOT_EMPTY,
  SNAPSHOT_MID,
} from "@/lib/leads/enrichment-mock";
import type { EnrichmentState, Tier } from "@/lib/leads/types";

const SHOWCASE_LEAD = MOCK_LEADS_52[0];

const TIERS: Tier[] = ["hot", "warm", "nurture", "drop"];

export function EnrichmentReview() {
  return (
    <section className="space-y-12">
      <Hero />

      <Subsection
        eyebrow="Atomic"
        title="Cell — five states"
        body="Every cell in the EnrichmentStream sheet is one of these. The shimmer on `inflight` is pure CSS so 52 simultaneous cells stay smooth. The corner tier dot only appears at status `scored` and pops in once via `data-enrichment-tier-pop`."
      >
        <CellStatesGrid />
      </Subsection>

      <Subsection
        eyebrow="Atomic"
        title="Cell — by tier"
        body="Tier dots are rose / amber / sky / slate, matching the existing workshop and tech-level chip palette."
      >
        <CellByTierGrid />
      </Subsection>

      <Subsection
        eyebrow="Composite"
        title="Detail card"
        body="Hover popover off a cell, or inline-in-chat when the agent calls `renderEnrichmentDetail({leadId})`. Same 320px max-width as LeadMiniCard / SegmentChip."
      >
        <DetailCardRow />
      </Subsection>

      <Subsection
        eyebrow="Container"
        title="Pill — collapsed forms"
        body="Slots into the top bar after the sheet closes. Click to re-expand. Three rest states: in-flight, complete, complete-with-errors."
      >
        <PillRow />
      </Subsection>

      <Subsection
        eyebrow="Container"
        title="Sheet — empty / idle"
        body="The run hasn't started. Every cell renders idle — dotted outline, faded initials. The progress bar is at 0%; counts hide entirely when zero."
      >
        <EnrichmentStream state={SNAPSHOT_EMPTY()} leads={MOCK_LEADS_52} />
      </Subsection>

      <Subsection
        eyebrow="Container"
        title="Sheet — early run"
        body="A few cells have started. Shimmer is the dominant motion signal; the rest of the grid stays calm so attention follows the active cells."
      >
        <EnrichmentStream state={SNAPSHOT_EARLY()} leads={MOCK_LEADS_52} />
      </Subsection>

      <Subsection
        eyebrow="Container"
        title="Sheet — mid run (the money shot)"
        body="Mix of all statuses. Scored cells front-load the grid (assignment is greedy by status), so the eye reads completion left-to-right. Error cells stay in their natural positions to surface gaps."
      >
        <EnrichmentStream state={SNAPSHOT_MID()} leads={MOCK_LEADS_52} />
      </Subsection>

      <Subsection
        eyebrow="Container"
        title="Sheet — complete"
        body="All cells scored. The header crossfades from `Enriching leads` to `Enrichment complete · 28s`. After this state lands, the parent page collapses the sheet to an EnrichmentPill in the top bar."
      >
        <EnrichmentStream
          state={SNAPSHOT_COMPLETE()}
          leads={MOCK_LEADS_52}
          onClose={() => {}}
        />
      </Subsection>

      <Subsection
        eyebrow="Container"
        title="Sheet — complete with errors"
        body="Error cells survive the transition to complete; they're still actionable (click-to-retry, in real wiring). The error count chip sits next to the scored chip in the header."
      >
        <EnrichmentStream
          state={SNAPSHOT_COMPLETE_WITH_ERRORS()}
          leads={MOCK_LEADS_52}
          onClose={() => {}}
        />
      </Subsection>

      <Subsection
        eyebrow="Wiring"
        title="State shape"
        body="EnrichmentState lives on the agent's shared state alongside leads, segments, and filter. Per-lead enrichment is keyed by `Lead.id` so cells re-render only when their slice changes."
      >
        <CodeBlock>{STATE_SHAPE_SOURCE}</CodeBlock>
      </Subsection>

      <Subsection
        eyebrow="Wiring"
        title="CopilotKit registration"
        body="Two surfaces: a state-driven canvas mount that opens the sheet whenever `enrichment.isActive` flips true, and a `useFrontendTool({ render })` so the agent can drop the sheet inline in the chat as a follow-up to questions like 'where are we?'."
      >
        <CodeBlock>{REGISTRATION_SOURCE}</CodeBlock>
      </Subsection>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section building blocks
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <div className="rounded-2xl border bg-card p-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-widest text-secondary">
        Generative UI · streaming
      </p>
      <h2 className="text-2xl font-bold text-foreground">EnrichmentStream</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        A long-running agent surface that renders one cell per lead in a fixed
        grid, with each cell streaming through{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          idle → inflight → summarized → scored
        </code>{" "}
        as the agent's parallel enrichment fan-out completes. Built on{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          useCoAgentStateRender
        </code>{" "}
        for the canvas mount and{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          useFrontendTool
        </code>{" "}
        for inline-in-chat embedding. Pure CSS shimmer so 52 simultaneous cells
        stay at 60fps.
      </p>
    </div>
  );
}

function Subsection({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-secondary">
          {eyebrow}
        </span>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mb-4 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
      <div className="rounded-xl border bg-muted/30 p-4">{children}</div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-card p-4 font-mono text-[11px] leading-relaxed text-foreground/90">
      <code>{children}</code>
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Cell state showcases
// ---------------------------------------------------------------------------

function CellStatesGrid() {
  const cases: { label: string; status: "idle" | "inflight" | "summarized" | "scored" | "error" }[] = [
    { label: "idle", status: "idle" },
    { label: "inflight", status: "inflight" },
    { label: "summarized", status: "summarized" },
    { label: "scored", status: "scored" },
    { label: "error", status: "error" },
  ];

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      {cases.map((c) => (
        <div key={c.label} className="flex flex-col items-center gap-2">
          <EnrichmentCell
            lead={SHOWCASE_LEAD}
            forceStatus={c.status}
            enrichment={
              c.status === "summarized"
                ? { status: "summarized", blurb: "Founder · agentic UI" }
                : c.status === "scored"
                  ? {
                      status: "scored",
                      blurb: "Founder · agentic UI",
                      score: 88,
                      tier: "hot",
                    }
                  : c.status === "error"
                    ? { status: "error", error: "timeout" }
                    : undefined
            }
          />
          <code className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {c.label}
          </code>
        </div>
      ))}
    </div>
  );
}

function CellByTierGrid() {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      {TIERS.map((tier, i) => (
        <div key={tier} className="flex flex-col items-center gap-2">
          <EnrichmentCell
            lead={MOCK_LEADS_52[i]}
            forceStatus="scored"
            enrichment={{
              status: "scored",
              blurb: "Sample lead",
              tier,
              score: 90 - i * 18,
            }}
            pop
          />
          <code className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            tier · {tier}
          </code>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail card showcase
// ---------------------------------------------------------------------------

function DetailCardRow() {
  const lead = {
    id: "demo-lead",
    name: "Anna Chen",
    role: "Founder",
    company: "Acme",
  };

  return (
    <div className="flex flex-wrap gap-4">
      <DetailLabel label="scored · hot">
        <EnrichmentDetailCard
          lead={lead}
          enrichment={{
            status: "scored",
            tier: "hot",
            score: 88,
            blurb: "Founder · agentic UI tooling, ex-Stripe",
            details:
              "Building agentic UI tooling for workflow automation. Heavy React/Next.js stack; recent commits to a CopilotKit-adjacent repo.",
            traceUrl: "#trace",
          }}
        />
      </DetailLabel>

      <DetailLabel label="summarized · awaiting score">
        <EnrichmentDetailCard
          lead={{ ...lead, name: "Marcus Reyes", role: "Eng leader" }}
          enrichment={{
            status: "summarized",
            blurb: "Eng leader at Series B fintech",
            details:
              "Eng leader at Series B fintech, evaluating internal copilots for support workflows. Notion-first culture.",
          }}
        />
      </DetailLabel>

      <DetailLabel label="error">
        <EnrichmentDetailCard
          lead={{ ...lead, name: "Priya Iyer", role: "ML engineer" }}
          enrichment={{
            status: "error",
            error: "Web search timed out after 4 attempts. Retry?",
          }}
        />
      </DetailLabel>
    </div>
  );
}

function DetailLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <code className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </code>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pill row showcase
// ---------------------------------------------------------------------------

function PillRow() {
  const active: EnrichmentState = SNAPSHOT_MID();
  const complete: EnrichmentState = SNAPSHOT_COMPLETE();
  const completeErrs: EnrichmentState = SNAPSHOT_COMPLETE_WITH_ERRORS();

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <PillLabel label="active · 28 / 52">
        <EnrichmentPill state={active} total={MOCK_LEADS_52.length} />
      </PillLabel>
      <PillLabel label="complete · 28s">
        <EnrichmentPill state={complete} total={MOCK_LEADS_52.length} />
      </PillLabel>
      <PillLabel label="complete · 5 errors">
        <EnrichmentPill state={completeErrs} total={MOCK_LEADS_52.length} />
      </PillLabel>
    </div>
  );
}

function PillLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {children}
      <code className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </code>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source snippets shown in the wiring sections
// ---------------------------------------------------------------------------

const STATE_SHAPE_SOURCE = `// src/lib/leads/types.ts

export type EnrichmentStatus =
  | "idle"
  | "inflight"
  | "summarized"
  | "scored"
  | "error";

export type Tier = "hot" | "warm" | "nurture" | "drop";

export interface LeadEnrichment {
  status: EnrichmentStatus;
  startedAt?: string;
  completedAt?: string;
  blurb?: string;        // 1-line headline
  details?: string;      // longer summary
  score?: number;        // 0-100
  tier?: Tier;
  traceUrl?: string;     // LangSmith run link
  error?: string;
}

export interface EnrichmentState {
  isActive: boolean;     // first inflight cell flips this true
  startedAt: string | null;
  completedAt: string | null;
  perLead: Record<string, LeadEnrichment>;  // keyed by Lead.id
}

// AgentState gains:
//   enrichment: EnrichmentState`;

const REGISTRATION_SOURCE = `// src/app/page.tsx — alongside the existing useFrontendTool registrations

// 1) Canvas mount: render the sheet whenever a run is active or just
//    completed. Reads directly off agent.state.enrichment, so any tick
//    that updates a per-lead slice re-renders only the affected cells.
const enrichment = state.enrichment;
const showSheet = enrichment.isActive || enrichment.completedAt;

// In the JSX:
{showSheet ? (
  <EnrichmentStream
    state={enrichment}
    leads={state.leads}
    onCellClick={(leadId) =>
      updateState((prev) => ({ ...prev, selectedLeadId: leadId }))
    }
    onClose={() =>
      updateState((prev) => ({
        ...prev,
        enrichment: { ...prev.enrichment, isActive: false },
      }))
    }
  />
) : null}

// 2) Inline-in-chat: agent calls renderEnrichmentStream({}) to drop the
//    sheet into the chat as a follow-up to "where are we?"-style asks.
useFrontendTool({
  name: "renderEnrichmentStream",
  description:
    "Render the live enrichment grid inline in chat. Use when the user " +
    "asks about progress / status / how the run is going. The component " +
    "reads agent state, so this tool takes no args.",
  parameters: z.object({}),
  render: () => (
    <EnrichmentStream
      state={state.enrichment}
      leads={state.leads}
    />
  ),
});`;
