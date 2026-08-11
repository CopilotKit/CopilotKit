"use client";

/**
 * SendQueueModal — *hard* HITL: gates outbound emails.
 *
 * Wired via `useInterrupt` on the canvas page; the agent emits a
 * `send_gate` interrupt with the queue, and this component renders as
 * the resolution UI. The user reviews each email, may exclude rows,
 * picks send channels, then commits with the big red CTA.
 *
 * Design choices:
 *   - Single big CTA that updates its count as rows are toggled
 *   - Cancel sits far from Send to make irreversible action deliberate
 *   - Recipient avatar stack in the header is a visceral count signal
 *   - Backdrop blur + slightly slower entrance to convey weight
 *   - No "are you sure?" double-confirm. The modal *is* the confirmation.
 *
 * Presentational only — caller passes the queue + resolve callbacks.
 */

import { useEffect, useMemo, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type {
  EmailDraft,
  Lead,
  SendChannel,
  SendQueueItem,
} from "@/lib/leads/types";
import { initials } from "@/lib/leads/derive";
import { EmailDraftCard } from "@/components/leads/inline/EmailDraftCard";

export interface SendQueueModalProps {
  open: boolean;
  /** All queued items. The user toggles `excluded` per row; final approved
   *  set is computed on send. */
  queue: SendQueueItem[];
  /** Lookup so we can render names + emails on each row. */
  leadsById: Record<string, Pick<Lead, "id" | "name" | "email" | "company" | "role">>;
  /** Send the approved subset. Caller resolves the interrupt with this. */
  onSend?: (approved: SendQueueItem[]) => void;
  onCancel?: () => void;
  /** Edit one draft inline. Caller persists the change. */
  onDraftChange?: (leadId: string, next: EmailDraft) => void;
  /** Switch the channel for one row. */
  onChannelChange?: (leadId: string, next: SendChannel) => void;
  /** Toggle row exclusion. */
  onToggleExclude?: (leadId: string) => void;
}

export function SendQueueModal({
  open,
  queue,
  leadsById,
  onSend,
  onCancel,
  onDraftChange,
  onChannelChange,
  onToggleExclude,
}: SendQueueModalProps) {
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);

  // Close expansion when modal closes; restore body scroll-lock.
  useEffect(() => {
    if (!open) {
      setExpandedLeadId(null);
      return;
    }
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  const approved = useMemo(
    () => queue.filter((q) => !q.excluded),
    [queue],
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] grid place-items-center bg-foreground/40 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel?.();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Review and send queued emails"
        >
          <motion.div
            className="flex max-h-[85vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {/* Header */}
            <header className="flex items-start justify-between gap-3 border-b border-border bg-muted/30 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Send queue · final review
                </div>
                <div className="mt-0.5 text-base font-semibold text-foreground">
                  {approved.length} {approved.length === 1 ? "email" : "emails"}{" "}
                  ready to send
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Once sent, this is irreversible. Toggle off any rows you want
                  to skip.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <RecipientStack
                  leads={approved
                    .map((q) => leadsById[q.leadId])
                    .filter(Boolean)
                    .slice(0, 6)}
                  total={approved.length}
                />
                <button
                  type="button"
                  onClick={onCancel}
                  aria-label="Close"
                  className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {queue.length === 0 ? (
                <div className="grid place-items-center py-12 text-center text-[12px] text-muted-foreground">
                  No emails queued yet.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {queue.map((item) => {
                    const lead = leadsById[item.leadId];
                    if (!lead) return null;
                    const expanded = expandedLeadId === item.leadId;
                    return (
                      <li key={item.leadId} className="py-3">
                        <QueueRow
                          item={item}
                          lead={lead}
                          expanded={expanded}
                          onToggleExpand={() =>
                            setExpandedLeadId(expanded ? null : item.leadId)
                          }
                          onToggleExclude={() => onToggleExclude?.(item.leadId)}
                          onChannelChange={(c) =>
                            onChannelChange?.(item.leadId, c)
                          }
                          onDraftChange={(d) => onDraftChange?.(item.leadId, d)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onSend?.(approved)}
                disabled={approved.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-[12px] font-semibold text-destructive-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="size-3.5" />
                Send {approved.length}{" "}
                {approved.length === 1 ? "email" : "emails"}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface QueueRowProps {
  item: SendQueueItem;
  lead: Pick<Lead, "id" | "name" | "email" | "company" | "role">;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleExclude: () => void;
  onChannelChange: (next: SendChannel) => void;
  onDraftChange: (next: EmailDraft) => void;
}

function QueueRow({
  item,
  lead,
  expanded,
  onToggleExpand,
  onToggleExclude,
  onChannelChange,
  onDraftChange,
}: QueueRowProps) {
  const excluded = !!item.excluded;
  return (
    <div
      className={`flex flex-col gap-2 rounded-md px-2 py-2 ${
        excluded ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={!excluded}
          onChange={onToggleExclude}
          className="size-4 shrink-0 rounded border-border"
          aria-label={`${excluded ? "Include" : "Exclude"} ${lead.name}`}
        />
        <Avatar name={lead.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-foreground">
            {lead.name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {item.draft.subject}
          </div>
        </div>
        <select
          value={item.channel}
          onChange={(e) => onChannelChange(e.target.value as SendChannel)}
          className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          aria-label="Send via channel"
        >
          <option value="gmail">gmail</option>
          <option value="resend">resend</option>
        </select>
        <button
          type="button"
          onClick={onToggleExpand}
          className="rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Collapse" : "Edit"}
        </button>
      </div>
      {expanded ? (
        <EmailDraftCard
          lead={lead}
          draft={item.draft}
          variant="expanded"
          onSubjectChange={(s) =>
            onDraftChange({ ...item.draft, subject: s })
          }
          onBodyChange={(b) => onDraftChange({ ...item.draft, body: b })}
          onToneChange={(t) => onDraftChange({ ...item.draft, tone: t })}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipient avatar stack
// ---------------------------------------------------------------------------

function RecipientStack({
  leads,
  total,
}: {
  leads: Pick<Lead, "id" | "name">[];
  total: number;
}) {
  return (
    <div className="flex -space-x-1.5">
      {leads.slice(0, 6).map((lead) => (
        <Avatar key={lead.id} name={lead.name} size="sm" />
      ))}
      {total > leads.length ? (
        <span className="grid size-7 place-items-center rounded-full bg-muted text-[10px] font-semibold text-foreground ring-2 ring-card">
          +{total - leads.length}
        </span>
      ) : null}
    </div>
  );
}

function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-card ${
        size === "sm" ? "size-7 text-[10px]" : "size-8 text-[11px]"
      }`}
      style={{ background: `hsl(${hue} 45% 50%)` }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkles helper for documentation — exported in case the showcase wants
// to reuse identical iconography.
// ---------------------------------------------------------------------------

export { Sparkles };
