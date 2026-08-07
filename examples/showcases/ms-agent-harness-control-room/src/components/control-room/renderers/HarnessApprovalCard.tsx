"use client";

/**
 * Card rendered for the synthetic `request_tool_approval` tool call that
 * our app-side `ApprovalContentWireBridge` emits whenever Harness's
 * `ToolApprovalAgent` queues a `ToolApprovalRequestContent`.
 *
 * The card surfaces the wrapped tool name + arguments so the operator can
 * see exactly what the agent wants to do. Clicking Approve / Reject (with
 * an optional "Don't ask again" checkbox) injects a tool-result message
 * keyed by the same call id; the wire bridge translates that back into a
 * `ToolApprovalResponseContent` (or `AlwaysApproveToolApprovalResponseContent`
 * for the don't-ask-again path) and feeds it to Harness's session-scoped
 * rule set — so the allowlist persists for the rest of the session without
 * any client-side bookkeeping.
 */

import { useState } from "react";
import {
  useAgent,
  useCopilotKit,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

import { PrimitiveWrapperBadge } from "@/components/control-room/PrimitiveWrapperBadge";
import { CONTROL_ROOM_AGENT_NAME } from "@/hooks/use-control-room-state";

interface ApprovalRequestPayload {
  approval_id?: string;
  function_name?: string;
  function_arguments?: Record<string, unknown>;
  message?: string;
}

interface RequestArgs {
  /** Serialized ApprovalRequestPayload — see ApprovalContentWireBridge.cs. */
  request_json?: string;
}

function parseRequestPayload(
  args: RequestArgs | undefined,
): ApprovalRequestPayload | null {
  if (!args?.request_json) return null;
  try {
    return JSON.parse(args.request_json) as ApprovalRequestPayload;
  } catch {
    return null;
  }
}

interface HarnessApprovalCardProps {
  toolCallId: string;
  args: RequestArgs | undefined;
  status: "inProgress" | "executing" | "complete";
  result: unknown;
}

type LocalState =
  | "pending"
  | "submitting"
  | "approved"
  | "rejected"
  | "resolved";

export function HarnessApprovalCard({
  toolCallId,
  args,
  status,
  result,
}: HarnessApprovalCardProps) {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({
    agentId: CONTROL_ROOM_AGENT_NAME,
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  // If the bridge already saw a tool result for this call id in the
  // message stream, the upstream status is "complete" — treat the card as
  // resolved so old approvals don't keep their action buttons.
  const initialState: LocalState =
    status === "complete" ? "resolved" : "pending";
  const [localState, setLocalState] = useState<LocalState>(initialState);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect whether the agent has already resolved this approval in the
  // session (e.g. via auto-approve rule). If the result message contains
  // approved=true and the bridge fed it back to Harness, the rest of the
  // turn unrolls without our intervention.
  const upstreamResolved = status === "complete";
  const effectiveState: LocalState =
    upstreamResolved && localState === "pending" ? "resolved" : localState;

  const request = parseRequestPayload(args);
  const toolName = request?.function_name ?? "(unknown tool)";
  const toolArgs = request?.function_arguments ?? {};
  const approvalId = request?.approval_id;

  async function submit(approved: boolean) {
    if (!toolCallId) {
      setError("Approval card is missing a call id; cannot respond.");
      return;
    }
    setLocalState("submitting");
    setError(null);
    const always_approve = approved && rememberChoice;
    const payload = JSON.stringify({
      approval_id: approvalId,
      approved,
      always_approve,
    });

    const a = agent as unknown as {
      addMessage: (m: {
        id: string;
        role: "tool";
        toolCallId: string;
        content: string;
      }) => void;
    };
    a.addMessage({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      role: "tool",
      toolCallId,
      content: payload,
    });

    try {
      await (
        copilotkit as unknown as {
          runAgent: (args: { agent: unknown }) => Promise<void>;
        }
      ).runAgent({ agent });
      setLocalState(approved ? "approved" : "rejected");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLocalState("pending");
    }
  }

  const canAct = effectiveState === "pending";
  const isWaiting = canAct;

  return (
    <div className="cr-tool-card" data-waiting={isWaiting ? "true" : undefined}>
      {isWaiting && (
        <div
          className="flex items-center gap-2 border border-[var(--cr-amber)] bg-[color-mix(in_oklab,var(--cr-amber)_18%,var(--cr-surface-3))] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--cr-amber)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          <span aria-hidden>⏸</span>
          <span>
            Harness wants to call “{toolName}” — Approve or Reject to continue.
          </span>
        </div>
      )}
      <header className="cr-tool-card__header">
        <h3 className="cr-tool-card__title">Approval · {toolName}</h3>
        <StatusChip state={effectiveState} />
        <PrimitiveWrapperBadge />
      </header>
      <section className="cr-tool-card__section">
        <div className="cr-tool-card__label">Proposed arguments</div>
        <pre className="cr-pre max-h-[200px]">
          {Object.keys(toolArgs).length === 0
            ? "{}"
            : JSON.stringify(toolArgs, null, 2)}
        </pre>
      </section>
      {error && (
        <p
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-red)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          {error}
        </p>
      )}
      {effectiveState === "resolved" && !upstreamResolved && (
        <p
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Already resolved this session.
        </p>
      )}
      {(canAct || effectiveState === "submitting") && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void submit(true)}
              disabled={!canAct}
              className="cr-btn"
              data-variant="primary"
            >
              {effectiveState === "submitting" ? "Submitting…" : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => void submit(false)}
              disabled={!canAct}
              className="cr-btn"
              data-variant="ghost"
            >
              Reject
            </button>
          </div>
          <label
            className="flex cursor-pointer items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted-2)]"
            style={{ fontFamily: "var(--cr-font-mono)" }}
          >
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(event) => setRememberChoice(event.target.checked)}
              disabled={!canAct}
              className="accent-[var(--cr-amber)]"
            />
            Don’t ask again this session for “{toolName}”
          </label>
        </div>
      )}
      <p
        className="text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Approval rule persists in Harness session state ·{" "}
        <code>{approvalId ?? "no-id"}</code>
      </p>
    </div>
  );
}

function StatusChip({ state }: { state: LocalState }) {
  const tone =
    state === "approved"
      ? "emerald"
      : state === "rejected"
        ? "red"
        : state === "submitting"
          ? "cyan"
          : state === "resolved"
            ? undefined
            : "amber";
  const label =
    state === "submitting"
      ? "submitting"
      : state === "approved"
        ? "approved"
        : state === "rejected"
          ? "rejected"
          : state === "resolved"
            ? "resolved"
            : "waiting";
  return (
    <span className="cr-chip" data-tone={tone}>
      {label}
    </span>
  );
}
