"use client";

/**
 * Card rendered for the synthetic `request_approval` tool call that
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

import { CONTROL_ROOM_AGENT_NAME } from "@/hooks/use-control-room-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

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
  const [rememberChoice, setRememberChoice] = useState(true);
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
    <Card
      size="sm"
      className={cn(
        "my-3 max-w-3xl rounded-xl py-4 shadow-none ring-border",
        isWaiting && "cr-pulse",
      )}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto text-sm">
            Approval · {toolName}
          </CardTitle>
          <StatusChip state={effectiveState} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isWaiting && (
          <Badge variant="secondary" className="w-fit">
            Harness wants to call {toolName}; approve or reject to continue
          </Badge>
        )}
        <section className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Proposed arguments
          </div>
          <pre className="max-h-[200px] overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs">
            {Object.keys(toolArgs).length === 0
              ? "{}"
              : JSON.stringify(toolArgs, null, 2)}
          </pre>
        </section>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {effectiveState === "resolved" && !upstreamResolved && (
          <p className="text-xs text-muted-foreground">
            Already resolved this session.
          </p>
        )}
        {(canAct || effectiveState === "submitting") && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void submit(true)}
                disabled={!canAct}
                size="sm"
              >
                {effectiveState === "submitting" ? "Submitting..." : "Approve"}
              </Button>
              <Button
                type="button"
                onClick={() => void submit(false)}
                disabled={!canAct}
                variant="outline"
                size="sm"
              >
                Reject
              </Button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={rememberChoice}
                onCheckedChange={(checked) => setRememberChoice(checked === true)}
                disabled={!canAct}
              />
              Remember approval for {toolName} this session
            </label>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Approval rule persists in Harness session state ·{" "}
          <code>{approvalId ?? "no-id"}</code>
        </p>
      </CardContent>
    </Card>
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
    <Badge
      variant={
        state === "approved"
          ? "default"
          : state === "rejected"
            ? "destructive"
            : "outline"
      }
      className="text-[10px]"
    >
      {label}
    </Badge>
  );
}
