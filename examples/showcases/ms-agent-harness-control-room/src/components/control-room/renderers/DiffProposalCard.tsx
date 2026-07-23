"use client";

/**
 * Card rendered for `repo_propose_patch` (and reused for
 * `command_request_approval`) tool calls. Surfaces the proposed payload plus
 * Approve / Reject controls wired to the Next.js proxy routes:
 *
 *   POST /api/approvals/[id]/approve
 *   POST /api/approvals/[id]/reject
 *
 * Both routes forward to the agent over the active endpoint header so the
 * proxy can validate the host. Local component state tracks the resolved
 * approval status to immediately reflect the user's click — the agent's next
 * state snapshot reconciles the canonical state.
 */

import { useEffect, useRef, useState } from "react";

import { PrimitiveWrapperBadge } from "@/components/control-room/PrimitiveWrapperBadge";
import { CodeBlock } from "@/components/control-room/renderers/CodeBlock";
import { useControlRoomState } from "@/hooks/use-control-room-state";
import {
  approvalSignature,
  loadApprovalAllowlist,
  rememberApproval,
} from "@/lib/approval-memory";
import { CONTROL_ROOM_ENDPOINT_HEADER } from "@/lib/endpoint";
import type { ApprovalRequest } from "@/lib/control-room-types";

interface DiffProposalCardProps {
  args?: {
    relative_path?: string;
    proposed_diff?: string;
    rationale?: string;
    command_name?: string;
  };
  status?: string;
  result?: ApprovalRequest;
  /**
   * Label tweak for command-vs-patch approvals. Defaults to "Patch proposal".
   */
  variant?: "patch" | "command";
}

type ApprovalLocalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "consumed"
  | "submitting";

export function DiffProposalCard({
  args,
  status,
  result,
  variant = "patch",
}: DiffProposalCardProps) {
  const { localState } = useControlRoomState();

  const upstreamStatus = result?.status ?? "pending";
  const [localStatus, setLocalStatus] =
    useState<ApprovalLocalStatus>(upstreamStatus);
  const [error, setError] = useState<string | null>(null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const autoApprovedRef = useRef(false);

  // Prefer the local resolved state once the user has acted; the agent's
  // upstream result is frozen at "pending" because the tool returned then.
  const effectiveStatus: ApprovalLocalStatus =
    localStatus === "pending"
      ? (upstreamStatus as ApprovalLocalStatus)
      : localStatus;

  const requestId = result?.request_id;
  const proposedDiff = args?.proposed_diff ?? "";
  const rationale = args?.rationale ?? "";
  const targetRaw =
    variant === "command"
      ? args?.command_name
      : (args?.relative_path ?? result?.payload_summary);
  const targetLabel =
    targetRaw ?? (variant === "command" ? "command" : "(file)");
  const signature = approvalSignature(variant, targetRaw);
  const isAlwaysApproved =
    signature !== null && loadApprovalAllowlist().has(signature);

  async function submit(action: "approve" | "reject") {
    if (!requestId) {
      setError("No request_id yet — wait for the agent to finish the call.");
      return;
    }
    setLocalStatus("submitting");
    setError(null);
    try {
      const response = await fetch(`/api/approvals/${requestId}/${action}`, {
        method: "POST",
        headers: {
          [CONTROL_ROOM_ENDPOINT_HEADER]: localState.currentEndpoint,
        },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text.slice(0, 200) || `HTTP ${response.status}`);
      }
      if (action === "approve" && rememberChoice && signature) {
        rememberApproval(signature);
      }
      setLocalStatus(action === "approve" ? "approved" : "rejected");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLocalStatus(upstreamStatus as ApprovalLocalStatus);
    }
  }

  const title = variant === "command" ? "Command request" : "Patch proposal";
  const canAct = effectiveStatus === "pending" && Boolean(requestId);
  const isWaiting = effectiveStatus === "pending";

  // Auto-approve pending requests whose signature was previously marked
  // "don't ask again". Fires once per card mount, only when we have a
  // request_id and the allowlist has been hit.
  useEffect(() => {
    if (autoApprovedRef.current) return;
    if (!canAct || !isAlwaysApproved) return;
    autoApprovedRef.current = true;
    void submit("approve");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAct, isAlwaysApproved]);

  return (
    <div className="cr-tool-card" data-waiting={isWaiting ? "true" : undefined}>
      {isWaiting && (
        <div
          className="flex items-center gap-2 border border-[var(--cr-amber)] bg-[color-mix(in_oklab,var(--cr-amber)_18%,var(--cr-surface-3))] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--cr-amber)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          <span aria-hidden>⏸</span>
          <span>Waiting on you — Approve or Reject below to continue.</span>
        </div>
      )}
      <header className="cr-tool-card__header">
        <h3 className="cr-tool-card__title">
          {title} · {targetLabel}
        </h3>
        <ApprovalStatusBadge status={effectiveStatus} />
        <PrimitiveWrapperBadge />
      </header>
      {rationale && (
        <section className="cr-tool-card__section">
          <div className="cr-tool-card__label">rationale</div>
          <p className="text-[11.5px] leading-snug text-[var(--cr-fg)]">
            {rationale}
          </p>
        </section>
      )}
      {variant === "patch" && (
        <section className="cr-tool-card__section">
          <div className="cr-tool-card__label">diff</div>
          {proposedDiff ? (
            <CodeBlock code={proposedDiff} language="diff" maxHeight={320} />
          ) : (
            <p
              className="text-[10.5px] italic uppercase tracking-[0.18em] text-[var(--cr-muted)]"
              style={{ fontFamily: "var(--cr-font-mono)" }}
            >
              (no diff body)
            </p>
          )}
        </section>
      )}
      {!result && status !== "complete" && (
        <p
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Waiting for approval token from the agent…
        </p>
      )}
      {requestId && (
        <p
          className="text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          request_id: <code>{requestId}</code>
        </p>
      )}
      {isAlwaysApproved && canAct && (
        <p
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-emerald)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          Auto-approving — “{targetLabel}” is on the always-approve list.
        </p>
      )}
      {(canAct || effectiveStatus === "submitting") && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => submit("approve")}
              disabled={!canAct}
              className="cr-btn"
              data-variant="primary"
            >
              {effectiveStatus === "submitting" ? "Submitting…" : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => submit("reject")}
              disabled={!canAct}
              className="cr-btn"
              data-variant="ghost"
            >
              Reject
            </button>
            {error && (
              <span
                className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-red)]"
                style={{ fontFamily: "var(--cr-font-mono)" }}
              >
                {error}
              </span>
            )}
          </div>
          {signature && !isAlwaysApproved && (
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
              Don’t ask again for “{targetLabel}”
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalStatusBadge({ status }: { status: ApprovalLocalStatus }) {
  const tone =
    status === "approved"
      ? "emerald"
      : status === "rejected"
        ? "red"
        : status === "consumed"
          ? undefined
          : "amber";
  return (
    <span className="cr-chip" data-tone={tone}>
      {status}
    </span>
  );
}
