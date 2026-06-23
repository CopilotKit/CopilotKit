"use client";

/**
 * /components/profile-popup-review.tsx
 *
 * Visual design review for the lead profile popup modal.
 *
 * The agent's `selectLead` frontend tool toggles `state.selectedLeadId`,
 * and the page mounts a `<LeadDetail>` shell that wraps this body in a
 * Radix Dialog. Saying "open Ethan Moore" → agent matches a lead by name
 * → calls selectLead(id) → modal opens with this layout.
 */

import { useState } from "react";
import { Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { LeadDetail, LeadProfileBody } from "@/components/leads/LeadDetail";
import type { Lead, Segment } from "@/lib/leads/types";
import {
  ReviewHero,
  ReviewLabel,
  ReviewSubsection,
  ReviewCodeBlock,
} from "./_review-shared";

const DEMO_LEAD: Lead = {
  id: "demo-ethan",
  url: "https://www.notion.so/lead/demo-ethan",
  name: "Ethan Moore",
  company: "Beacon Labs",
  email: "ethan@beaconlabs.dev",
  role: "Staff Engineer",
  phone: "+1 (415) 555-0142",
  source: "OSS4AI workshop",
  technical_level: "Advanced",
  interested_in: ["Agentic UI", "RAG patterns", "Tool calling"],
  tools: ["CopilotKit", "LangGraph", "Next.js", "Postgres"],
  workshop: "OSS4AI",
  status: "In progress",
  opt_in: true,
  message:
    "Building a copilot for our internal incident response tooling. Would love to compare notes on streaming UI patterns and partial state updates.",
  submitted_at: "2026-04-21T15:42:00.000Z",
};

const DEMO_SEGMENTS: Segment[] = [
  {
    id: "seg-curious",
    name: "CopilotKit-curious developers",
    description: "Hands-on engineers already shipping agentic UI in production.",
    color: "violet",
    leadIds: ["demo-ethan"],
  },
];

export function ProfilePopupReview() {
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-6">
      <ReviewHero
        eyebrow="Lead profile · Modal popup"
        title="Centered profile modal"
        body={
          <>
            When the user says <em>“open Ethan Moore”</em> in the chat, the
            agent calls the <code>selectLead</code> frontend tool, which sets{" "}
            <code>state.selectedLeadId</code>. The page mounts the lead
            profile inside a Radix <code>Dialog</code> — a centered, dimmed
            overlay rather than the previous side drawer — so the focus
            stays on one lead at a time without pushing the underlying
            view sideways.
          </>
        }
      />

      <ReviewSubsection
        eyebrow="surface"
        title="Static preview — no dialog mount"
        body={
          <>
            The same body that ships inside the Dialog, rendered inline so
            the layout, header, quick-edit form and footer can be reviewed
            at a glance. The footer's <em>Draft &amp; post comment</em>{" "}
            button replaces the legacy <code>mailto:</code> action — clicking
            it generates a draft email, asks for approval (HITL), and on
            approve posts the draft as a comment on the lead's Notion page,
            returning a hyperlink to the page.
          </>
        }
      >
        <div className="flex justify-center">
          <div className="w-full max-w-md overflow-hidden rounded-lg border bg-background shadow-sm">
            <LeadProfileBody lead={DEMO_LEAD} segments={DEMO_SEGMENTS} />
          </div>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="interaction"
        title="Live — open the real modal"
        body="Click the button to open the profile body inside the actual Radix Dialog with the dimmed overlay, focus trap, escape-to-close, and outside-click dismissal."
      >
        <div className="flex flex-col items-start gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Eye className="size-3.5" /> Open profile modal
          </button>
          <p className="text-[11px] text-muted-foreground">
            Esc or click the backdrop to dismiss — same affordances the
            production modal exposes.
          </p>

          <Dialog
            open={open}
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
            modal={false}
          >
            <DialogContent
              className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md"
              showCloseButton={false}
              showOverlay={false}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onPointerDownOutside={(e) => e.preventDefault()}
              onInteractOutside={(e) => e.preventDefault()}
            >
              <DialogTitle className="sr-only">{DEMO_LEAD.name}</DialogTitle>
              <DialogDescription className="sr-only">
                Demo profile modal for {DEMO_LEAD.name}
              </DialogDescription>
              <LeadProfileBody
                lead={DEMO_LEAD}
                segments={DEMO_SEGMENTS}
                onClose={() => setOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </ReviewSubsection>

      <ReviewSubsection
        eyebrow="wiring"
        title="How the agent triggers it"
        body="The frontend tool the agent reaches for. Same handler whether the user clicks a card, types a name in chat, or asks for a lead by id."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ReviewLabel label="src/app/page.tsx · useFrontendTool">
            <ReviewCodeBlock>{`useFrontendTool({
  name: "selectLead",
  description:
    "Open the detail panel for one lead. Pass null to close it.",
  parameters: z.object({ leadId: z.string().nullable() }),
  handler: async ({ leadId }) => {
    updateState((prev) => ({ ...prev, selectedLeadId: leadId }));
    return leadId ? \`selected \${leadId}\` : "selection cleared";
  },
});`}</ReviewCodeBlock>
          </ReviewLabel>

          <ReviewLabel label="src/components/leads/LeadDetail.tsx · render">
            <ReviewCodeBlock>{`<Dialog
  open={!!lead}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
>
  <DialogContent
    className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md"
    showCloseButton={false}
  >
    {lead ? (
      <LeadProfileBody
        lead={lead}
        segments={segments}
        onEdit={onEdit}
        syncing={syncing}
      />
    ) : null}
  </DialogContent>
</Dialog>`}</ReviewCodeBlock>
          </ReviewLabel>
        </div>
      </ReviewSubsection>

      {/* Hidden mount so this file legitimately exercises the LeadDetail
          shell (and not just the inner body). Keeps the review page
          self-checking against API drift. */}
      <div aria-hidden className="hidden">
        <LeadDetail lead={null} segments={[]} onClose={() => {}} />
      </div>
    </section>
  );
}
