"use client";

/**
 * /components/render-tools-review.tsx
 *
 * Catalog of plain render tools — `useFrontendTool({ render })` — already
 * shipped or designed in this app, that the agent drops inline in chat as
 * a way of *showing* an answer rather than describing it.
 *
 * Charts (LeadRadar, TierDonut, ScoreDistribution) and HITL surfaces
 * (RubricProposalCard) are *also* render tools but get dedicated review
 * sections; this section catalogs the small/medium ones that don't fit
 * either bucket.
 */

import { LeadMiniCard } from "@/components/leads/inline/LeadMiniCard";
import { SegmentChip } from "@/components/leads/inline/SegmentChip";
import { DemandSpark } from "@/components/leads/inline/DemandSpark";
import { EmailDraftCard } from "@/components/leads/inline/EmailDraftCard";
import type { EmailDraft, Lead } from "@/lib/leads/types";
import {
  ReviewHero,
  ReviewLabel,
  ReviewSubsection,
  ReviewCodeBlock,
} from "./_review-shared";

const SAMPLE_LEAD: Pick<Lead, "id" | "name" | "email" | "company" | "role"> = {
  id: "demo-lead",
  name: "Anna Chen",
  email: "anna@acme.dev",
  company: "Acme",
  role: "Founder",
};

const COMPACT_DRAFT: EmailDraft = {
  tone: "founder-to-founder",
  subject: "Quick note from the OSS4AI workshop",
  body: "Anna —\n\nWe both ended up in the agentic-UI camp last week. I'm running a small follow-up on Thursday focused on the exact problem you mentioned (multi-step approvals). 6 people, 45 min.\n\nWorth your time?\n\n— J",
  rationale: "Founder-to-founder · matches your reply pattern",
};

const MOCK_DEMAND_LEADS: Lead[] = Array.from({ length: 18 }, (_, i) => ({
  id: `mock-${i}`,
  name: `Lead ${i}`,
  company: "",
  email: "",
  role: "",
  technical_level: "Developer",
  interested_in: [],
  tools: [],
  workshop: [
    "Agentic UI (AG-UI)",
    "MCP Apps / Tooling",
    "RAG & Data Chat",
    "Evaluations & Guardrails",
    "Deploying Agents (prod)",
  ][i % 5],
  status: "Not started",
  opt_in: true,
  message: "",
  submitted_at: "",
}));

export function RenderToolsReview() {
  return (
    <section className="space-y-12">
      <ReviewHero
        eyebrow="Generative UI · render tools"
        title="Inline-in-chat components"
        body={
          <>
            Render-only tools the agent drops into the chat stream when a
            picture beats a paragraph. Each one is a{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              useFrontendTool
            </code>{" "}
            with a <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">render</code>{" "}
            slot and no handler — so the component mounts, the user clicks
            through, and any side effects fire from the component's own
            buttons (which call other handler-bearing tools). 320–400px max
            width to fit the chat sidebar comfortably.
          </>
        }
      />

      <ReviewSubsection
        eyebrow="Reference"
        title="LeadMiniCard"
        body="Already shipped. The agent renders this whenever it mentions a specific lead by name. Click 'Open in canvas' to focus the lead's detail panel."
      >
        <ReviewLabel label="Full props">
          <LeadMiniCard
            leadId="demo-lead"
            name="Anna Chen"
            role="Founder"
            company="Acme"
            email="anna@acme.dev"
            workshop="Agentic UI (AG-UI)"
            technical_level="Developer"
          />
        </ReviewLabel>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Reference"
        title="SegmentChip"
        body="The seed pattern for soft HITL. Agent proposes a segment; user Accepts (commits via addSegment), Edits (re-prompts), or Discards. Mirror this scaffolding when introducing any new soft-HITL chip."
      >
        <ReviewLabel label="Default">
          <SegmentChip
            name="CopilotKit-curious developers"
            description="Developer-tier signups whose tools include React or Next.js."
            color="indigo"
            leadIds={["a", "b", "c", "d", "e", "f", "g"]}
          />
        </ReviewLabel>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Reference"
        title="DemandSpark"
        body="Compact 3-bar inline chart. Use when the user asks 'what's hot' / 'rank workshops' and a sentence-sized answer is overkill but a full DemandView is too much."
      >
        <ReviewLabel label="Top workshops">
          <DemandSpark leads={MOCK_DEMAND_LEADS} />
        </ReviewLabel>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="New"
        title="EmailDraftCard · compact"
        body="Read-only preview that fits in the chat sidebar. Hovering a paragraph reveals a per-paragraph regenerate button. Click 'Open' to expand into the editable form (used in SendQueueModal)."
      >
        <ReviewLabel label="In-chat preview">
          <EmailDraftCard
            lead={SAMPLE_LEAD}
            draft={COMPACT_DRAFT}
            variant="compact"
            onToggleExpand={() => {}}
            onRegenerate={() => {}}
            onQueue={() => {}}
          />
        </ReviewLabel>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="New"
        title="EmailDraftCard · expanded"
        body="The fully editable form. Tone toggle is a single-select chip group; switching tone fires onToneChange (parent decides whether to re-prompt the agent or rewrite locally). Subject + body are inputs; per-paragraph regenerate stays available."
      >
        <ReviewLabel label="Editable in modal">
          <EmailDraftCard
            lead={SAMPLE_LEAD}
            draft={COMPACT_DRAFT}
            variant="expanded"
            onSubjectChange={() => {}}
            onBodyChange={() => {}}
            onToneChange={() => {}}
            onRegenerate={() => {}}
            onQueue={() => {}}
          />
        </ReviewLabel>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="Wiring"
        title="The render-tool pattern"
        body="A render-only tool: no handler, no side effects from the agent's call. Side effects come from the component's own buttons, which call OTHER handler-bearing tools. This separation keeps the agent honest: it can't 'send' anything by mounting a component."
      >
        <ReviewCodeBlock>{REGISTRATION_SOURCE}</ReviewCodeBlock>
      </ReviewSubsection>
    </section>
  );
}

const REGISTRATION_SOURCE = `// src/app/page.tsx — render-only tool pattern (no handler)

useFrontendTool({
  name: "renderEmailDraft",
  description:
    "Render an email draft inline in chat. Use AFTER drafting, BEFORE " +
    "queueing — let the user open and edit before they commit. " +
    "Side effects (queue, send) happen via the component's buttons, " +
    "which call queueDraft / openSendQueue, not from this tool itself.",
  parameters: z.object({
    leadId: z.string(),
    leadName: z.string().optional(),
    draft: z.object({
      subject: z.string(),
      body: z.string(),
      tone: z.enum([
        "casual",
        "technical",
        "founder-to-founder",
        "conference-followup",
      ]),
      rationale: z.string().optional(),
    }),
  }),
  render: ({ args }) => (
    <EmailDraftCard
      lead={lookupLead(args.leadId) ?? { id: args.leadId, name: args.leadName ?? "" }}
      draft={args.draft}
      variant="compact"
      onToggleExpand={() => openDraftInModal(args.leadId)}
      onRegenerate={() => regenerateDraft(args.leadId)}
      onQueue={() => queueDraft(args.leadId, args.draft)}
    />
  ),
});`;
