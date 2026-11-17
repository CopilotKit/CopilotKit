"use client";

import { z } from "zod";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";

// The value of `MASTRA_OBSERVATIONAL_MEMORY_ACTIVITY_TYPE` in @ag-ui/mastra.
// This file does not import the adapter: the adapter re-exports the Node-only
// `@mastra/core` (fs, stream/web), which webpack cannot bundle into a client
// component. The activity type is a stable protocol string, so a local
// constant is the correct client-side reference. Keep it in sync with the
// adapter.
const MASTRA_OBSERVATIONAL_MEMORY_ACTIVITY_TYPE = "mastra-observational-memory";

/**
 * Content schema for the Mastra Observational Memory activity.
 *
 * It follows the shape that @ag-ui/mastra documents on
 * `MASTRA_OBSERVATIONAL_MEMORY_ACTIVITY_TYPE`. Only `cycleId`, `phase` and
 * `status` are required. Which other fields arrive depends on the OM phase
 * (buffering or activation). Unknown keys pass through, so content from an
 * adapter version that adds fields still validates.
 */
export const omActivityContentSchema = z.looseObject({
  cycleId: z.string(),
  operationType: z.enum(["observation", "reflection"]).optional(),
  phase: z.string(),
  status: z.string(),
  threadId: z.string().optional(),
  observations: z.string().optional(),
  currentTask: z.string().optional(),
  suggestedResponse: z.string().optional(),
  tokensToObserve: z.number().optional(),
  tokensObserved: z.number().optional(),
  bufferedTokens: z.number().optional(),
  observationTokens: z.number().optional(),
  tokensActivated: z.number().optional(),
  chunksActivated: z.number().optional(),
  messagesActivated: z.number().optional(),
  triggeredBy: z.string().optional(),
  durationMs: z.number().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});

type OMActivityContent = z.infer<typeof omActivityContentSchema>;

const PHASE_LABEL: Partial<Record<string, string>> = {
  observation: "Observing conversation",
  buffering: "Compressing memory",
  activation: "Activating observations",
};

const STATUS_LABEL: Partial<Record<string, string>> = {
  running: "Working",
  completed: "Compressed",
  activated: "Activated",
  failed: "Failed",
};

// Any other status (a finished cycle) is green.
const STATUS_COLOR: Partial<Record<string, string>> = {
  failed: "#ef4444",
  running: "#f59e0b",
};

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#10b981";
  const pulse = status === "running";
  return (
    <span
      data-testid="om-status-dot"
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        animation: pulse ? "om-pulse 1.2s ease-in-out infinite" : undefined,
      }}
    />
  );
}

/**
 * Inline card rendered for each OM activity cycle. One card per `cycleId`;
 * it advances running -> completed -> activated as deltas arrive.
 */
function OMActivityCard({ content }: { content: OMActivityContent }) {
  const phaseLabel = PHASE_LABEL[content.phase] ?? content.phase;
  const statusLabel = STATUS_LABEL[content.status] ?? content.status;

  return (
    <div
      data-testid="om-activity-card"
      data-om-phase={content.phase}
      data-om-status={content.status}
      style={{
        border: "1px solid rgba(148, 163, 184, 0.3)",
        borderRadius: 12,
        padding: "10px 14px",
        margin: "8px 0",
        background: "rgba(148, 163, 184, 0.06)",
        fontSize: 13,
      }}
    >
      <style>{`@keyframes om-pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 600,
        }}
      >
        <StatusDot status={content.status} />
        <span>{phaseLabel}</span>
        <span style={{ opacity: 0.5, fontWeight: 400 }}>· {statusLabel}</span>
      </div>
      {content.observations ? (
        <div
          data-testid="om-observations"
          style={{ marginTop: 6, opacity: 0.85, lineHeight: 1.4 }}
        >
          {content.observations}
        </div>
      ) : null}
      {typeof content.bufferedTokens === "number" ||
      typeof content.tokensActivated === "number" ? (
        <div style={{ marginTop: 6, opacity: 0.6, fontSize: 12 }}>
          {typeof content.bufferedTokens === "number"
            ? `${content.bufferedTokens} tokens buffered`
            : null}
          {typeof content.tokensActivated === "number"
            ? `${content.tokensActivated} tokens activated`
            : null}
        </div>
      ) : null}
      {content.error ? (
        <div style={{ marginTop: 6, color: "#ef4444" }}>{content.error}</div>
      ) : null}
    </div>
  );
}

/**
 * Activity renderer registered on `<CopilotKit renderActivityMessages={...}>`.
 * CopilotKit routes every `mastra-observational-memory` activity message to
 * this renderer and re-invokes it as the activity advances via ACTIVITY_DELTA.
 */
export const observationalMemoryActivityRenderer: ReactActivityMessageRenderer<OMActivityContent> =
  {
    activityType: MASTRA_OBSERVATIONAL_MEMORY_ACTIVITY_TYPE,
    content: omActivityContentSchema,
    render: ({ content }) => <OMActivityCard content={content} />,
  };
