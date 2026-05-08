"use client";

/**
 * /components/email-draft-review.tsx
 *
 * Visual design review for the inline email-draft surface.
 *
 * The agent's `renderEmailDraft` frontend tool drops an `EmailDraftCard`
 * into the chat stream when the user says "draft / write / compose an
 * email to <name>". Tone is one of four; the card has Regenerate and
 * Queue actions that round-trip back to the agent via `injectPrompt`.
 *
 * The agent prompt for this surface lives in
 * `agent/src/prompts.py::GENERATIVE_UI_PROMPT` under the
 * `renderEmailDraft({...})` bullet.
 */

import { EmailDraftCard } from "@/components/leads/inline/EmailDraftCard";
import type { EmailDraft, Lead } from "@/lib/leads/types";
import {
  ReviewHero,
  ReviewLabel,
  ReviewSubsection,
  ReviewCodeBlock,
} from "./_review-shared";

const DEMO_LEAD: Pick<Lead, "id" | "name" | "email" | "company" | "role"> = {
  id: "demo-ethan",
  name: "Ethan Moore",
  email: "ethan@beaconlabs.dev",
  company: "Beacon Labs",
  role: "Staff Engineer",
};

const DEMO_DRAFTS: { variant: EmailDraft; label: string }[] = [
  {
    label: "Tone: technical",
    variant: {
      subject: "OSS4AI workshop — preflight materials for Beacon Labs",
      body:
        "Hi Ethan,\n\nThanks for grabbing a slot in the OSS4AI track. Saw your stack in the form (LangGraph + Postgres + tool-calling) — we'll have time to compare notes on partial state updates and streaming UI patterns during the breakout.\n\nA quick favor: would you mind sharing one repro repo or a sanitized snippet of the agent loop you're shipping? Even a 50-line gist helps me line up the right preflight materials.\n\nTalk soon,\nThe team",
      tone: "technical",
      rationale:
        "Lead is a Staff Engineer with a deep stack — leaning technical signals respect for their expertise.",
    },
  },
  {
    label: "Tone: founder-to-founder",
    variant: {
      subject: "30 min next week, Ethan?",
      body:
        "Hey Ethan — quick one. We've shipped enough variants of this to know the gotchas; happy to spend 30 min on whatever's currently slowing you down.\n\nDrop two times that work and I'll send a calendar hold.\n\n—",
      tone: "founder-to-founder",
      rationale:
        "Direct ask, low ceremony. Matches Beacon Labs' early-stage signal in the lead notes.",
    },
  },
];

export function EmailDraftReview() {
  return (
    <section className="space-y-6">
      <ReviewHero
        eyebrow="Outreach · Email draft"
        title="Inline email draft card"
        body={
          <>
            Mounted by the agent via <code>renderEmailDraft</code> when the
            user asks for an outreach email. The compact card lives in the
            chat stream; clicking <em>Open ↗</em> expands into the
            send-queue modal for full editing. Tone tag in the header
            tells the user (and the agent) which voice the draft is
            written in.
          </>
        }
      />

      <ReviewSubsection
        eyebrow="surface"
        title="Compact variant — by tone"
        body="Each tone is a distinct voice. The agent picks one based on the lead's role / tools / company stage; the user can hit Regenerate to nudge a different angle without re-typing the prompt."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {DEMO_DRAFTS.map(({ label, variant }) => (
            <div key={variant.tone}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {label}
              </p>
              <EmailDraftCard
                lead={DEMO_LEAD}
                draft={variant}
                variant="compact"
              />
            </div>
          ))}
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="wiring"
        title="How the agent triggers it"
        body="Tool registration plus the prompt rule that disambiguates which tool to reach for when the user says 'draft / write / compose an email to <name>'."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ReviewLabel label="src/app/page.tsx · useFrontendTool">
            <ReviewCodeBlock>{`useFrontendTool({
  name: "renderEmailDraft",
  description:
    "Render a draft outreach email inline in chat. " +
    "Use AFTER drafting, BEFORE queueing — the user opens it to edit. " +
    "Side effects (queue, send) happen via the component's buttons, " +
    "which call other tools. Do NOT call queueEmail in the same turn.",
  parameters: z.object({
    leadId: z.string(),
    leadName: z.string().optional(),
    leadEmail: z.string().optional(),
    leadCompany: z.string().optional(),
    leadRole: z.string().optional(),
    draft: z.object({
      subject: z.string(),
      body: z.string(),
      tone: z.enum(TONE_VALUES),
      rationale: z.string().optional(),
    }),
  }),
  render: ({ args }) => <LiveEmailDraft args={args} />,
});`}</ReviewCodeBlock>
          </ReviewLabel>

          <ReviewLabel label="agent/src/prompts.py · GENERATIVE_UI_PROMPT">
            <ReviewCodeBlock>{`- renderEmailDraft({leadId, draft: {subject, body, tone, rationale?}}):
  inline draft outreach email. Call this WHENEVER the user says
  "draft / write / compose / send an email to <name>" or asks for an
  outreach message for a specific lead. Resolve <name> against
  state.leads to get the leadId — match on full or partial name
  (case-insensitive) and prefer the highest-confidence hit. Compose
  subject + body yourself; pick \`tone\` from
  'casual' | 'technical' | 'founder-to-founder' | 'conference-followup'
  based on the lead's role / tools / company stage. Optionally include
  a short \`rationale\` so the user sees why you chose that tone. The
  card has Regenerate and Queue buttons that round-trip back to you —
  do NOT queue or send in the same turn as renderEmailDraft.`}</ReviewCodeBlock>
          </ReviewLabel>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="reactivity"
        title="Why the render is wrapped in <LiveEmailDraft />"
        body={
          <>
            v2 <code>useFrontendTool</code> registers the render closure
            inside a <code>useEffect</code> whose deps don&apos;t include
            the closure itself, so any closure-captured agent state is
            frozen at first mount. The wrapper subscribes via{" "}
            <code>useAgent()</code> — re-renders on every state change
            and reads <code>agent.state.leads</code> fresh, so the card
            always shows the live company / role even when the agent
            only echoed <code>leadId</code> back through the tool args.
          </>
        }
      >
        <ReviewCodeBlock>{`function LiveEmailDraft({ args }: { args: LiveEmailDraftArgs }) {
  const { state } = useLiveAgentState(); // useAgent() under the hood
  const injectPrompt = useInjectPrompt();
  if (!args.leadId || !args.draft) {
    return <StreamingChip label="Drafting email…" />;
  }
  const fromState = state.leads.find((l) => l.id === args.leadId);
  const lead = fromState ?? { id: args.leadId, name: args.leadName ?? "(unknown lead)", ... };
  return (
    <EmailDraftCard
      lead={lead}
      draft={args.draft}
      variant="compact"
      onRegenerate={() => injectPrompt(\`Regenerate the outreach email for \${lead.name}\`)}
      onQueue={() => injectPrompt(\`Queue the email for \${lead.name} into the send queue.\`)}
    />
  );
}`}</ReviewCodeBlock>
      </ReviewSubsection>
    </section>
  );
}
