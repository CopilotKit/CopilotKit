"use client";

import React from "react";
import { z } from "zod";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";

// Inlined from @ag-ui/mastra's `MASTRA_OBSERVATIONAL_MEMORY_ACTIVITY_TYPE`.
// We intentionally do NOT import the bridge here: it re-exports the Node-only
// `@mastra/core` (fs / stream/web), which webpack refuses to bundle into a
// client component. The activity type is a stable protocol string, so a local
// constant is the correct client-side reference. Kept in sync with the bridge.
const MASTRA_OBSERVATIONAL_MEMORY_ACTIVITY_TYPE = "mastra-observational-memory";

/**
 * Content schema for the Mastra Observational Memory activity.
 *
 * Mirrors the shape documented on `MASTRA_OBSERVATIONAL_MEMORY_ACTIVITY_TYPE`
 * in @ag-ui/mastra. All fields but `cycleId`/`phase`/`status` are optional —
 * which fields are present depends on the OM phase (buffering vs activation).
 * Everything is `.optional()`/`.passthrough()`-tolerant so a future bridge
 * that adds fields still validates.
 */
export const omActivityContentSchema = z
  .object({
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
  })
  .passthrough();

type OMActivityContent = z.infer<typeof omActivityContentSchema>;

const PHASE_LABEL: Record<string, string> = {
  observation: "Observing conversation",
  buffering: "Compressing memory",
  activation: "Activating observations",
};

const STATUS_LABEL: Record<string, string> = {
  running: "Working",
  completed: "Compressed",
  activated: "Activated",
  failed: "Failed",
};

function StatusDot({ status }: { status: string }) {
  const color =
    status === "failed"
      ? "#ef4444"
      : status === "running"
        ? "#f59e0b"
        : "#10b981";
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
