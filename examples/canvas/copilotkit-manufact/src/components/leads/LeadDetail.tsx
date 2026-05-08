"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Mail,
  MessageSquare,
  MessageSquarePlus,
  Phone,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Lead, Segment } from "@/lib/leads/types";
import { STATUSES, TECH_LEVELS, WORKSHOPS } from "@/lib/leads/types";
import {
  initials,
  techLevelClass,
  workshopClass,
  segmentDotClass,
} from "@/lib/leads/derive";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { NotionLink } from "./LeadCard";

interface LeadDetailProps {
  lead: Lead | null;
  segments: Segment[];
  onClose: () => void;
  /**
   * Phase 04: called when the user edits an in-panel control. The page-
   * level handler in `app/page.tsx` is responsible for applying the
   * optimistic patch, kicking off the Notion write through the agent's
   * `update_notion_lead` tool, and rolling back on failure.
   */
  onEdit?: (leadId: string, patch: Partial<Lead>) => void;
  /** Phase 04: a write is currently in flight for this lead. */
  syncing?: boolean;
}

export function LeadDetail({
  lead,
  segments,
  onClose,
  onEdit,
  syncing,
}: LeadDetailProps) {
  // The modal must coexist with the CopilotKit chat sidebar — the user
  // needs to be able to type in chat while the profile is open. Radix
  // Dialog defaults to `modal={true}`, which (a) traps focus inside the
  // dialog (chat input becomes unfocusable), (b) treats every outside
  // pointer-down as a close trigger (clicking into chat dismisses), and
  // (c) renders a dimmed backdrop that blocks clicks underneath. We turn
  // all of that off here so the panel behaves like a floating sticky
  // popup: stays open while the user works elsewhere, dismissed only via
  // Escape or the explicit X button. `onOpenAutoFocus.preventDefault()`
  // also keeps the chat input's focus when the agent calls selectLead
  // mid-typing.
  return (
    <Dialog
      open={!!lead}
      onOpenChange={(open) => {
        if (!open) onClose();
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
        {lead ? (
          <>
            <DialogTitle className="sr-only">{lead.name}</DialogTitle>
            <DialogDescription className="sr-only">
              Lead profile for {lead.name}
              {lead.company ? ` at ${lead.company}` : ""}
            </DialogDescription>
            <LeadProfileBody
              lead={lead}
              segments={segments}
              onEdit={onEdit}
              syncing={syncing}
              onClose={onClose}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The visual contents of the lead profile modal. Pulled out of the
 * `LeadDetail` shell so the /components review page can render it inline
 * without owning the `Dialog` lifecycle.
 *
 * `onClose` is optional: the /components static preview renders this body
 * outside a Dialog and has nothing to dismiss, so the X button is hidden
 * when no callback is provided.
 */
export function LeadProfileBody({
  lead,
  segments,
  onEdit,
  syncing,
  onClose,
}: {
  lead: Lead;
  segments: Segment[];
  onEdit?: (leadId: string, patch: Partial<Lead>) => void;
  syncing?: boolean;
  onClose?: () => void;
}) {
  const memberOf = segments.filter((s) => s.leadIds.includes(lead.id));

  return (
    <div className="flex flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={lead.name} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{lead.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {lead.role}
              {lead.company ? ` @ ${lead.company}` : null}
            </div>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </header>

      <div className="max-h-[70vh] overflow-y-auto p-4">
        <div className="space-y-4">
          <section className="flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${workshopClass(
                lead.workshop,
              )}`}
            >
              {lead.workshop}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${techLevelClass(
                lead.technical_level,
              )}`}
            >
              {lead.technical_level}
            </span>
            {lead.opt_in ? (
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300">
                opted in
              </span>
            ) : null}
            {lead.source ? (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
                via {lead.source}
              </span>
            ) : null}
          </section>

          {onEdit ? (
            <section
              data-syncing={syncing ? "true" : undefined}
              className="relative space-y-3 rounded-md border border-border bg-muted/30 p-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Quick edit
                </h3>
                <span className="text-[10px] text-muted-foreground/70">
                  syncs to Notion
                </span>
              </div>
              <EditRow label="Status">
                <Select
                  value={lead.status || undefined}
                  onValueChange={(v) => onEdit(lead.id, { status: v })}
                  disabled={syncing}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Pick a status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </EditRow>
              <EditRow label="Workshop">
                <Select
                  value={lead.workshop}
                  onValueChange={(v) => onEdit(lead.id, { workshop: v })}
                  disabled={syncing}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Pick a workshop" />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKSHOPS.map((w) => (
                      <SelectItem key={w} value={w}>
                        {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </EditRow>
              <EditRow label="Technical level">
                <Select
                  value={lead.technical_level || undefined}
                  onValueChange={(v) =>
                    onEdit(lead.id, { technical_level: v })
                  }
                  disabled={syncing}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Pick a level" />
                  </SelectTrigger>
                  <SelectContent>
                    {TECH_LEVELS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </EditRow>
              <EditRow label="Opt-in to updates">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={lead.opt_in}
                    onCheckedChange={(v) =>
                      onEdit(lead.id, { opt_in: Boolean(v) })
                    }
                    disabled={syncing}
                    aria-label="Toggle opt-in"
                  />
                  <span className="text-xs text-muted-foreground">
                    {lead.opt_in ? "Opted in" : "Not opted in"}
                  </span>
                </div>
              </EditRow>
            </section>
          ) : null}

          <section className="space-y-2 text-sm">
            <DetailRow icon={Mail} label="Email">
              <a
                href={`mailto:${lead.email}`}
                className="text-foreground underline-offset-2 hover:underline"
              >
                {lead.email}
              </a>
            </DetailRow>
            {lead.phone ? (
              <DetailRow icon={Phone} label="Phone">
                {lead.phone}
              </DetailRow>
            ) : null}
            {lead.submitted_at ? (
              <DetailRow label="Submitted">
                {formatTimestamp(lead.submitted_at)}
              </DetailRow>
            ) : null}
          </section>

          {lead.tools.length > 0 ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tools they use
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {lead.tools.map((t) => (
                  <span
                    key={t}
                    className={`rounded-md bg-muted px-2 py-1 text-xs ${
                      t === "CopilotKit"
                        ? "ring-1 ring-primary/40 text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {lead.interested_in.length > 0 ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Interested in
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {lead.interested_in.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {lead.message ? (
            <section>
              <h3 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MessageSquare className="size-3" /> Message
              </h3>
              <p className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground">
                {lead.message}
              </p>
            </section>
          ) : null}

          {memberOf.length > 0 ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Segments
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {memberOf.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
                  >
                    <span
                      className={`size-1.5 rounded-full ${segmentDotClass(s.color)}`}
                    />
                    {s.name}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <NotionCommentFooter lead={lead} />
    </div>
  );
}

/**
 * Demo-only "post comment to Notion" composer that replaces the original
 * `mailto:` button. Local state, no real Notion call — the modal stays
 * frontend-only here so the lead-triage demo can show the round-trip
 * affordance without wiring a Notion comment endpoint through the BFF.
 *
 * If you wire this up for real, the natural plumbing is a new agent tool
 * (e.g. `comment_on_notion_lead`) sitting next to `update_notion_lead`
 * in `agent/src/notion_tools.py`, with a thin frontend handler that
 * injects the user's prompt and lets the agent post the comment via the
 * Notion MCP `notion-create-comment` tool.
 */
type FooterPhase = "idle" | "drafting" | "review" | "posting" | "done";

interface DraftEmail {
  subject: string;
  body: string;
}

/**
 * Build a deterministic draft email for the demo. In production this is
 * where you'd hand off to the agent — e.g. injectPrompt(`Draft a follow-up
 * email to ${lead.name}`) — and pipe the result back into `setDraft`.
 */
function makeDraftEmail(lead: Lead): DraftEmail {
  const firstName = lead.name.split(" ")[0] || lead.name;
  const subject = lead.workshop
    ? `${lead.workshop} workshop — next steps for ${firstName}`
    : `Quick follow-up — next steps for ${firstName}`;
  const interests = lead.interested_in?.length
    ? lead.interested_in.slice(0, 3).join(", ")
    : "the topics you flagged when you signed up";
  const company = lead.company ? ` from ${lead.company}` : "";
  const body = `Hi ${firstName},

Thanks for signing up for the ${lead.workshop} track${company}. I noticed you're interested in ${interests} — happy to share a tighter agenda once we have your slot locked.

Could you share a couple of times this week that work? Even a 15-minute call helps me line up the right preflight materials.

Talk soon,
The team`;
  return { subject, body };
}

function notionFallbackUrl(lead: Lead): string {
  return lead.url ?? `https://www.notion.so/?lead=${encodeURIComponent(lead.id)}`;
}

/**
 * Demo HITL flow: click → agent drafts an email → user reviews + edits →
 * approve → simulated Notion comment write → success state with deep
 * link back to the lead's Notion page.
 *
 * Why HITL here: posting to a customer-facing Notion page is irreversible
 * (you can't unsay a comment), which is exactly the SendQueueModal /
 * useInterrupt pattern's domain. We mirror the soft-edit + hard-approve
 * shape locally so the demo doesn't depend on a real agent round-trip.
 *
 * For the production wiring: replace `makeDraftEmail` with an agent
 * `draft_lead_followup` tool, and replace the simulated post with a
 * `comment_on_notion_lead` tool that calls Notion MCP `create-comment`
 * and returns the resulting page URL into `setNotionUrl`.
 */
function NotionCommentFooter({ lead }: { lead: Lead }) {
  const [phase, setPhase] = useState<FooterPhase>("idle");
  const [draft, setDraft] = useState<DraftEmail>({ subject: "", body: "" });
  const [notionUrl, setNotionUrl] = useState<string | null>(null);

  const startDraft = async () => {
    setPhase("drafting");
    // Simulate the agent drafting time so the UI shows the work.
    await new Promise((resolve) => setTimeout(resolve, 500));
    setDraft(makeDraftEmail(lead));
    setPhase("review");
  };

  const cancel = () => {
    setPhase("idle");
    setDraft({ subject: "", body: "" });
  };

  const approveAndPost = async () => {
    if (!draft.subject.trim() || !draft.body.trim()) return;
    setPhase("posting");
    // Simulated Notion round-trip — keeps the demo standalone.
    await new Promise((resolve) => setTimeout(resolve, 450));
    const url = notionFallbackUrl(lead);
    setNotionUrl(url);
    setPhase("done");
    toast.success(`Comment posted on ${lead.name}'s Notion page`, {
      action: {
        label: "View",
        onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
      },
    });
  };

  return (
    <footer className="border-t border-border">
      {phase === "idle" ? (
        <div className="flex items-center justify-between p-3">
          <NotionLink url={lead.url} />
          <button
            type="button"
            onClick={startDraft}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles className="size-3.5" /> Draft & post comment
          </button>
        </div>
      ) : null}

      {phase === "drafting" ? (
        <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 animate-pulse text-primary" />
          Drafting follow-up email for {lead.name}…
        </div>
      ) : null}

      {phase === "review" || phase === "posting" ? (
        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-3 text-primary" /> Draft email · review
              before posting
            </span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300">
              awaiting approval
            </span>
          </div>
          <input
            value={draft.subject}
            onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
            disabled={phase === "posting"}
            placeholder="Subject"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            disabled={phase === "posting"}
            rows={6}
            className="w-full resize-none rounded-md border border-border bg-background p-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              On approval, this draft is posted as a comment on{" "}
              {lead.name}&apos;s Notion page.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={phase === "posting"}
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={approveAndPost}
                disabled={
                  phase === "posting" ||
                  !draft.subject.trim() ||
                  !draft.body.trim()
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <MessageSquarePlus className="size-3.5" />
                {phase === "posting" ? "Posting…" : "Approve & post"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="flex items-center justify-between gap-3 bg-emerald-500/5 p-3">
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">
                Comment posted on Notion
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {draft.subject}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {notionUrl ? (
              <a
                href={notionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <ExternalLink className="size-3.5" /> View on Notion
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                setDraft({ subject: "", body: "" });
                setNotionUrl(null);
              }}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </footer>
  );
}

function Avatar({ name }: { name: string }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <div
      className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
      style={{ background: `hsl(${hue} 45% 50%)` }}
    >
      {initials(name)}
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex w-24 shrink-0 items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="size-3" /> : null}
        <span>{label}</span>
      </div>
      <div className="min-w-0 flex-1 truncate text-sm text-foreground">
        {children}
      </div>
    </div>
  );
}

function EditRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}
