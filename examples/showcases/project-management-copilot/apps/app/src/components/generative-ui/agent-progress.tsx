"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  Check,
  Eye,
  FileText,
  ListChecks,
  PenLine,
  Sparkles,
} from "lucide-react";

/**
 * Animated "agent step in progress" card. Used by the sprint-planning demo to
 * narrate the cycle: reading_image -> transcribing -> planning_tickets ->
 * writing_tickets -> complete. Each card mounts in "in_progress" state with a
 * spinner, then transitions to a green check after IN_PROGRESS_MS so the steps
 * animate sequentially as the fixture emits them.
 *
 * Time-based (not stream-status-based) so the animation plays the same
 * regardless of how fast aimock streams the tool-call args.
 *
 * The final `complete` step is special: when it transitions to "done" it
 * broadcasts a module-level signal that tells all *previous* step cards to
 * collapse (height + opacity to 0). Result: the four narration cards visually
 * fold into the single "Analysis and breakdown complete" summary card.
 */
export const AgentProgressProps = z.object({
  step: z
    .enum([
      "reading_image",
      "transcribing",
      "planning_tickets",
      "writing_tickets",
      "complete",
    ])
    .describe(
      "Which agent step this card represents. Drives the icon and label. The terminal 'complete' step also triggers prior step cards to collapse.",
    ),
  detail: z
    .string()
    .optional()
    .describe(
      "Optional one-line detail shown under the step label, e.g. 'found 5 priorities'.",
    ),
});

export type AgentProgressArgs = z.infer<typeof AgentProgressProps>;

const IN_PROGRESS_MS = 900;
const COLLAPSE_MS = 420;

// Module-level pub/sub so the `complete` step card can tell every previously
// mounted step card to collapse, without needing a shared React context. Each
// non-`complete` card subscribes on mount; the `complete` card fires the
// signal when it flips to "done".
const collapseSubscribers = new Set<() => void>();
function broadcastCollapse() {
  for (const fn of collapseSubscribers) fn();
}
function subscribeCollapse(fn: () => void) {
  collapseSubscribers.add(fn);
  return () => {
    collapseSubscribers.delete(fn);
  };
}

const STEP_META: Record<
  AgentProgressArgs["step"],
  {
    inProgress: string;
    done: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  reading_image: {
    inProgress: "Reading image…",
    done: "Read image",
    Icon: Eye,
  },
  transcribing: {
    inProgress: "Transcribing notes…",
    done: "Transcribed notes",
    Icon: FileText,
  },
  planning_tickets: {
    inProgress: "Planning Cycle 52 tickets…",
    done: "Planned 3 tickets",
    Icon: ListChecks,
  },
  writing_tickets: {
    inProgress: "Writing tickets to the board…",
    done: "Updated board",
    Icon: PenLine,
  },
  complete: {
    inProgress: "Wrapping up…",
    done: "Analysis and breakdown complete",
    Icon: Sparkles,
  },
};

export function AgentProgress({ step, detail }: AgentProgressArgs) {
  const [phase, setPhase] = useState<"in_progress" | "done">("in_progress");
  const [collapsed, setCollapsed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const meta = STEP_META[step];
  const isComplete = step === "complete";

  useEffect(() => {
    const t = setTimeout(() => setPhase("done"), IN_PROGRESS_MS);
    return () => clearTimeout(t);
  }, []);

  // Non-terminal step cards listen for the collapse broadcast.
  useEffect(() => {
    if (isComplete) return;
    return subscribeCollapse(() => setCollapsed(true));
  }, [isComplete]);

  // The terminal "complete" card fires the broadcast once it lands on "done".
  useEffect(() => {
    if (!isComplete) return;
    if (phase !== "done") return;
    broadcastCollapse();
  }, [isComplete, phase]);

  if (!meta) return null;
  const Icon = meta.Icon;
  const isDone = phase === "done";

  return (
    <div
      ref={cardRef}
      className="max-w-md w-full"
      style={{
        background: "rgba(255, 255, 255, 0.65)",
        border: "2px solid #ffffff",
        borderRadius: 8,
        padding: collapsed ? "0 12px" : "8px 12px",
        marginBottom: collapsed ? 0 : 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        boxShadow: collapsed ? "none" : "0px 1px 3px 0px rgba(1, 5, 7, 0.08)",
        // Cards we just want to disappear collapse height + opacity together,
        // pulling the summary card up into the freed space.
        maxHeight: collapsed ? 0 : 200,
        opacity: collapsed ? 0 : 1,
        overflow: "hidden",
        transform: collapsed ? "translateY(-4px)" : "translateY(0)",
        transition: `max-height ${COLLAPSE_MS}ms ease, opacity ${COLLAPSE_MS}ms ease, margin ${COLLAPSE_MS}ms ease, padding ${COLLAPSE_MS}ms ease, transform ${COLLAPSE_MS}ms ease`,
        pointerEvents: collapsed ? "none" : undefined,
      }}
      aria-hidden={collapsed || undefined}
    >
      <style>{`
        @keyframes agentProgressSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes agentProgressCheckPop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes agentProgressFadeIn {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        className="flex items-center justify-center rounded-md flex-none"
        style={{
          width: 28,
          height: 28,
          background: isDone ? "#189370" : "#ffffff",
          border: isDone ? "0" : "1px solid #dbdbe5",
          transition: "background-color 220ms ease-out",
        }}
      >
        {isDone ? (
          <span
            style={{
              display: "inline-flex",
              animation:
                "agentProgressCheckPop 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <Check className="h-4 w-4 text-white" strokeWidth={3} />
          </span>
        ) : (
          <span
            style={{
              display: "inline-flex",
              animation: "agentProgressSpin 1.1s linear infinite",
            }}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "#010507",
            lineHeight: 1.25,
            animation: isDone
              ? "agentProgressFadeIn 0.28s ease-out"
              : undefined,
          }}
        >
          {isDone ? meta.done : meta.inProgress}
        </div>
        {detail && (
          <div
            style={{
              fontSize: 11,
              color: "#57575b",
              marginTop: 2,
              lineHeight: 1.35,
            }}
          >
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}
