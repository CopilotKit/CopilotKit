"use client";

/**
 * /components/hitl-review.tsx
 *
 * Visual design review for the human-in-the-loop surfaces.
 *
 * Two flavors of HITL in CopilotKit, distinguished by *what they gate*:
 *
 *   Soft HITL — useFrontendTool({ render })
 *     Inline preview before the agent commits. Agent does NOT block. If the
 *     user does nothing, no commit happens. Used for reversible / cheap
 *     decisions: rubric proposals, segment proposals, retiers.
 *
 *   Hard HITL — useInterrupt
 *     The agent pauses mid-graph and waits for the user to resolve. Used
 *     for irreversible side effects: outbound emails, deletes, public posts.
 *
 * The demo's design is deliberately frugal with hard interrupts: only the
 * SendQueueModal earns one. Everything else uses the lighter soft pattern.
 */

import { useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { RubricProposalCard } from "@/components/leads/hitl/RubricProposalCard";
import { SendQueueModal } from "@/components/leads/hitl/SendQueueModal";
import type { Lead, RubricProposal, SendQueueItem } from "@/lib/leads/types";
import {
  ReviewHero,
  ReviewLabel,
  ReviewSubsection,
  ReviewCodeBlock,
} from "./_review-shared";

const FRESH_RUBRIC: RubricProposal = {
  name: "OSS4AI workshop fit",
  description: "Score signal for ranking workshop signups against ICP.",
  reason:
    "I noticed 4 founders in the list — adding 'Decision-maker' as a 5th dimension.",
  dimensions: [
    { id: "tool_overlap", label: "Tool overlap", weight: 30 },
    { id: "tech_level", label: "Technical level", weight: 20 },
    { id: "workshop_match", label: "Workshop match", weight: 20 },
    { id: "company_stage", label: "Company stage", weight: 15 },
    { id: "decision_maker", label: "Decision-maker", weight: 15 },
  ],
};

const UPDATE_RUBRIC: RubricProposal = {
  name: "OSS4AI workshop fit",
  reason:
    "You moved 2 investors to Drop in the last minute — lowering Investor weight, raising Decision-maker.",
  dimensions: [
    { id: "tool_overlap", label: "Tool overlap", weight: 30 },
    { id: "tech_level", label: "Technical level", weight: 20 },
    { id: "workshop_match", label: "Workshop match", weight: 20 },
    { id: "company_stage", label: "Company stage", weight: 10 },
    { id: "decision_maker", label: "Decision-maker", weight: 20 },
  ],
  previousWeights: {
    tool_overlap: 30,
    tech_level: 20,
    workshop_match: 20,
    company_stage: 15,
    decision_maker: 15,
  },
};

const MOCK_LEADS: Record<string, Pick<Lead, "id" | "name" | "email" | "company" | "role">> = {
  "lead-1": {
    id: "lead-1",
    name: "Anna Chen",
    email: "anna@acme.dev",
    company: "Acme",
    role: "Founder",
  },
  "lead-2": {
    id: "lead-2",
    name: "Marcus Reyes",
    email: "marcus@globex.io",
    company: "Globex",
    role: "Eng leader",
  },
  "lead-3": {
    id: "lead-3",
    name: "Priya Iyer",
    email: "priya@initech.com",
    company: "Initech",
    role: "ML engineer",
  },
  "lead-4": {
    id: "lead-4",
    name: "Sven Larsen",
    email: "sven@massivedyn.com",
    company: "Massive Dynamic",
    role: "Solo dev",
  },
};

const MOCK_QUEUE: SendQueueItem[] = [
  {
    leadId: "lead-1",
    channel: "gmail",
    draft: {
      tone: "founder-to-founder",
      subject: "Quick note from the OSS4AI workshop",
      body: "Anna —\n\nWe both ended up in the agentic-UI camp last week. I'm running a small follow-up on Thursday focused on the exact problem you mentioned (multi-step approvals). 6 people, 45 min.\n\nWorth your time?\n\n— J",
      rationale: "Founder-to-founder · matches your reply pattern",
    },
  },
  {
    leadId: "lead-2",
    channel: "resend",
    draft: {
      tone: "technical",
      subject: "Re: AG-UI internals @ Globex",
      body: "Marcus —\n\nFollowing up on the question about streaming intermediate tool calls. We just shipped a pattern that should work for the support-routing agent you described.\n\nGist + a 12-line example: [link]\n\nHappy to dig in if useful.",
      rationale: "Technical · the question they asked was technical",
    },
  },
  {
    leadId: "lead-3",
    channel: "gmail",
    draft: {
      tone: "casual",
      subject: "RAG eval kit — got 5 min?",
      body: "Hey Priya — saw the eval thread. We ship something close to what you sketched and I'd love your read on it before we finalize. Got 5?",
    },
    excluded: true,
  },
  {
    leadId: "lead-4",
    channel: "gmail",
    draft: {
      tone: "conference-followup",
      subject: "OSS4AI follow-up · Notion-AI plugin",
      body: "Sven — caught the demo on Wednesday. The Notion-AI plugin got real laughs in the right way. We're spinning up a small group of solo builders next month — interested?",
    },
  },
];

export function HitlReview() {
  const [modalOpen, setModalOpen] = useState(false);
  const [queue, setQueue] = useState<SendQueueItem[]>(MOCK_QUEUE);

  return (
    <section className="space-y-12">
      <ReviewHero
        eyebrow="Generative UI · human-in-the-loop"
        title="HITL surfaces"
        body={
          <>
            Two flavors of HITL: <strong>soft</strong> via{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              useFrontendTool({"{"} render {"}"})
            </code>{" "}
            (preview before commit, agent never blocks) and <strong>hard</strong> via{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              useInterrupt
            </code>{" "}
            (agent pauses mid-graph until user resolves). The demo earns
            exactly one hard interrupt — the SendQueueModal — so the moment
            lands. Everything else stays soft.
          </>
        }
      />

      <ReviewSubsection
        eyebrow="Soft HITL"
        title="RubricProposalCard"
        body="Inline-in-chat. The agent proposes a rubric (fresh or update); user clicks Apply / Tune / Discard. If they ignore it, nothing happens. Update proposals show ▲/▼ deltas next to each weight bar so the change is legible at a glance."
      >
        <div className="flex flex-wrap gap-6">
          <ReviewLabel label="Fresh proposal · all 5 dimensions">
            <RubricProposalCard proposal={FRESH_RUBRIC} />
          </ReviewLabel>
          <ReviewLabel label="Update · with previous-weight deltas">
            <RubricProposalCard proposal={UPDATE_RUBRIC} />
          </ReviewLabel>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Hard HITL"
        title="SendQueueModal"
        body="The only useInterrupt-driven surface in the demo. Agent emits a `send_gate` interrupt with the queued items; this modal renders as the resolution UI. Per-row checkbox + channel selector; one big destructive CTA whose count updates as the user toggles rows; cancel sits far from send so the irreversible action has to be deliberate."
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-[12px] font-semibold text-destructive-foreground hover:brightness-110"
            >
              <Send className="size-3.5" />
              Open SendQueueModal
            </button>
            <span className="text-[11px] text-muted-foreground">
              The modal opens as it would when the agent emits a `send_gate`
              interrupt mid-run. Toggle rows, change channels, cancel, send —
              all wired locally for review.
            </span>
          </div>
          <div className="rounded-md border border-dashed border-border bg-card/40 p-4 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-widest text-secondary">
              <Sparkles className="size-3" />
              In production
            </span>
            <p className="mt-1.5 leading-relaxed">
              The agent calls{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                interrupt(send_gate, queue)
              </code>{" "}
              from inside its LangGraph node. The frontend's{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                useInterrupt({"{"} name: "send_gate", render {"}"})
              </code>{" "}
              hook receives the event, mounts this modal, and resolves with
              the approved subset when the user clicks Send. The agent
              continues its run with that subset.
            </p>
          </div>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Wiring"
        title="Soft vs hard registration"
        body="The two HITL flavors register through different hooks. Soft is identical in shape to a regular render-only tool. Hard subscribes to the interrupt event and resolves it with a payload."
      >
        <ReviewCodeBlock>{REGISTRATION_SOURCE}</ReviewCodeBlock>
      </ReviewSubsection>

      {/* Live modal — driven by the showcase state, not a real interrupt */}
      <SendQueueModal
        open={modalOpen}
        queue={queue}
        leadsById={MOCK_LEADS}
        onCancel={() => setModalOpen(false)}
        onSend={(approved) => {
          setModalOpen(false);
          // eslint-disable-next-line no-alert
          alert(
            `Would send ${approved.length} email(s). (Showcase only — no real send.)`,
          );
        }}
        onToggleExclude={(leadId) =>
          setQueue((prev) =>
            prev.map((q) =>
              q.leadId === leadId ? { ...q, excluded: !q.excluded } : q,
            ),
          )
        }
        onChannelChange={(leadId, channel) =>
          setQueue((prev) =>
            prev.map((q) => (q.leadId === leadId ? { ...q, channel } : q)),
          )
        }
        onDraftChange={(leadId, draft) =>
          setQueue((prev) =>
            prev.map((q) => (q.leadId === leadId ? { ...q, draft } : q)),
          )
        }
      />
    </section>
  );
}

const REGISTRATION_SOURCE = `// src/app/page.tsx — soft HITL via useFrontendTool

useFrontendTool({
  name: "renderRubricProposal",
  description:
    "Propose a rubric inline in chat for the user to Apply / Tune / Discard. " +
    "Use BEFORE applying any rubric change — never call the apply tool in the " +
    "same turn. If the user ignores the proposal, nothing should change.",
  parameters: z.object({
    name: z.string(),
    description: z.string().optional(),
    reason: z.string().optional(),
    dimensions: z.array(z.object({
      id: z.string(),
      label: z.string(),
      weight: z.number(),
      description: z.string().optional(),
    })),
    previousWeights: z.record(z.number()).optional(),
  }),
  render: ({ args }) => (
    <RubricProposalCard
      proposal={args}
      onApply={(p) => applyRubric(p)}
      onTune={(p) => openRubricEditor(p)}
    />
  ),
});

// src/app/page.tsx — hard HITL via useInterrupt

useInterrupt({
  // Listens for events emitted by graph.interrupt({name: "send_gate", value: queue})
  enabled: (event) => event.name === "send_gate",
  render: ({ event, resolve }) => (
    <SendQueueModal
      open
      queue={event.value.queue}
      leadsById={event.value.leadsById}
      onSend={(approved) => resolve({ approved })}
      onCancel={() => resolve({ approved: [] })}
    />
  ),
});`;
