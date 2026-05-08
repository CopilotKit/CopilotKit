"use client";

/**
 * EmailDraftCard — the agent's draft outreach email, surfaced inline in chat.
 *
 * Two contexts:
 *   - `variant="compact"` (default): subject + body preview + tone tag,
 *     ~320px wide. Fits in the chat sidebar.
 *   - `variant="expanded"`: full editable subject + body, tone toggle, and
 *     a per-paragraph regenerate gesture. Used inside SendQueueModal.
 *
 * The compact form is read-only — the user clicks "Open ↗" to expand into
 * the modal where editing happens. Keeps the chat surface uncluttered.
 *
 * Tone change is a destructive UI action (replaces body), so the toggle
 * fires `onToneChange`; the parent decides whether to re-prompt the agent
 * or do an in-place rewrite. The component does not mutate body itself.
 */

import { useState } from "react";
import { Mail, RefreshCcw, Send, Sparkles, X } from "lucide-react";
import {
  EMAIL_TONES,
  type EmailDraft,
  type EmailTone,
  type Lead,
} from "@/lib/leads/types";

const TONE_LABEL: Record<EmailTone, string> = {
  casual: "Casual",
  technical: "Technical",
  "founder-to-founder": "Founder-to-founder",
  "conference-followup": "Conference follow-up",
};

const TONE_BLURB: Record<EmailTone, string> = {
  casual: "Conversational, no jargon. ~3 sentences.",
  technical: "Specific to their stack. Code/repo references OK.",
  "founder-to-founder": "Direct, brief. Acknowledge the trench.",
  "conference-followup": "References a specific moment. Tight ask.",
};

export interface EmailDraftCardProps {
  lead: Pick<Lead, "id" | "name" | "email" | "company" | "role">;
  draft: EmailDraft;
  variant?: "compact" | "expanded";
  /** Compact: opens the expanded form. Expanded: collapses back. */
  onToggleExpand?: () => void;
  /** User picked a different tone; parent decides how to rewrite. */
  onToneChange?: (tone: EmailTone) => void;
  /** Trigger an unconditional regenerate of the whole draft. */
  onRegenerate?: () => void;
  /** Send / queue from the card. Optional — usually queued through the modal. */
  onQueue?: () => void;
  /** Local edits in expanded mode propagate up. */
  onSubjectChange?: (next: string) => void;
  onBodyChange?: (next: string) => void;
}

export function EmailDraftCard({
  lead,
  draft,
  variant = "compact",
  onToggleExpand,
  onToneChange,
  onRegenerate,
  onQueue,
  onSubjectChange,
  onBodyChange,
}: EmailDraftCardProps) {
  const [hoveredParaIndex, setHoveredParaIndex] = useState<number | null>(null);

  const isExpanded = variant === "expanded";
  const paragraphs = draft.body.split(/\n\n+/);
  const recipient = lead.email
    ? `${lead.name} <${lead.email}>`
    : lead.name;

  return (
    <div
      className={`my-2 rounded-xl border border-border bg-card shadow-sm ${
        isExpanded ? "max-w-[640px]" : "max-w-[360px]"
      }`}
    >
      {/* Header */}
      <header className="flex items-start gap-2 border-b border-border/60 px-3 py-2.5">
        <Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Draft outreach
          </div>
          <div className="truncate text-[11px] text-foreground">
            To · {recipient}
          </div>
        </div>
        <ToneTag tone={draft.tone} />
        {isExpanded && onToggleExpand ? (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label="Collapse"
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </header>

      {/* Subject */}
      <div className="px-3 pt-2.5">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Subject
        </div>
        {isExpanded ? (
          <input
            type="text"
            value={draft.subject}
            onChange={(e) => onSubjectChange?.(e.target.value)}
            className="w-full rounded-md border border-border bg-input px-2 py-1 text-sm font-medium text-foreground outline-none focus:border-secondary"
          />
        ) : (
          <div className="text-sm font-medium text-foreground">
            {draft.subject || "(no subject)"}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Body
          </span>
          {draft.rationale ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Sparkles className="size-2.5 text-secondary" aria-hidden />
              {draft.rationale}
            </span>
          ) : null}
        </div>

        {isExpanded ? (
          <textarea
            value={draft.body}
            onChange={(e) => onBodyChange?.(e.target.value)}
            rows={Math.max(6, Math.min(14, paragraphs.length * 3))}
            className="w-full resize-y rounded-md border border-border bg-input px-2 py-1.5 text-[12px] leading-relaxed text-foreground outline-none focus:border-secondary"
          />
        ) : (
          <div className="space-y-1.5 text-[11px] leading-relaxed text-foreground/85">
            {paragraphs.slice(0, 3).map((p, i) => (
              <div
                key={i}
                onMouseEnter={() => setHoveredParaIndex(i)}
                onMouseLeave={() => setHoveredParaIndex(null)}
                className="group relative"
              >
                {p}
                {/* Per-paragraph regenerate hint (compact view shows on hover) */}
                {hoveredParaIndex === i && onRegenerate ? (
                  <button
                    type="button"
                    onClick={onRegenerate}
                    className="absolute -right-1 top-0 inline-flex size-5 items-center justify-center rounded-md bg-card text-muted-foreground shadow ring-1 ring-border hover:text-foreground"
                    aria-label="Regenerate paragraph"
                    title="Regenerate this paragraph"
                  >
                    <RefreshCcw className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
            {paragraphs.length > 3 ? (
              <div className="text-[10px] italic text-muted-foreground">
                + {paragraphs.length - 3} more paragraphs (open to read)
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Tone toggle (expanded only) */}
      {isExpanded ? (
        <div className="border-t border-border/60 px-3 py-2.5">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tone
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EMAIL_TONES.map((t) => {
              const active = t === draft.tone;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onToneChange?.(t)}
                  title={TONE_BLURB[t]}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {TONE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-muted/20 px-3 py-2.5">
        {!isExpanded && onToggleExpand ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open
          </button>
        ) : null}
        {onRegenerate ? (
          <button
            type="button"
            onClick={onRegenerate}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent/10"
          >
            <RefreshCcw className="size-3" />
            Regenerate
          </button>
        ) : null}
        {onQueue ? (
          <button
            type="button"
            onClick={onQueue}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-secondary/30 bg-secondary/10 px-2.5 py-1 text-[11px] font-medium text-secondary hover:bg-secondary/15"
          >
            <Send className="size-3" />
            Queue to send
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ToneTag({ tone }: { tone: EmailTone }) {
  return (
    <span className="inline-flex items-center rounded-full bg-secondary/10 px-1.5 py-0.5 text-[10px] font-medium text-secondary ring-1 ring-inset ring-secondary/30">
      {TONE_LABEL[tone]}
    </span>
  );
}
