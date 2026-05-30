"use client";

/**
 * Card rendered for `repo_propose_patch` (and reused for
 * `command_request_approval`) tool calls from older control-room snapshots.
 * The current Harness approval path is `request_approval` rendered by
 * `HarnessApprovalCard`; this component remains as a parked diff renderer so
 * older traces still have a readable fallback.
 */

import { CodeBlock } from "@/components/control-room/renderers/CodeBlock";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ApprovalRequest } from "@/lib/control-room-types";
import { cn } from "@/lib/utils";

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
  const upstreamStatus = result?.status ?? "pending";
  const effectiveStatus = upstreamStatus as ApprovalLocalStatus;

  const requestId = result?.request_id;
  const proposedDiff = args?.proposed_diff ?? "";
  const rationale = args?.rationale ?? "";
  const targetRaw =
    variant === "command"
      ? args?.command_name
      : (args?.relative_path ?? result?.payload_summary);
  const targetLabel =
    targetRaw ?? (variant === "command" ? "command" : "(file)");

  const title = variant === "command" ? "Command request" : "Patch proposal";
  const isWaiting = effectiveStatus === "pending";

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
            {title} · {targetLabel}
          </CardTitle>
          <ApprovalStatusBadge status={effectiveStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isWaiting && (
          <Badge variant="secondary" className="w-fit">
            Legacy diff trace; current approvals use Harness cards
          </Badge>
        )}
        {rationale && (
          <section className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Rationale
            </div>
            <p className="text-sm leading-relaxed text-foreground">
              {rationale}
            </p>
          </section>
        )}
        {variant === "patch" && (
          <section className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Diff</div>
            {proposedDiff ? (
              <CodeBlock code={proposedDiff} language="diff" maxHeight={320} />
            ) : (
              <p className="text-xs italic text-muted-foreground">
                (no diff body)
              </p>
            )}
          </section>
        )}
        {!result && status !== "complete" && (
          <p className="text-xs text-muted-foreground">
            Waiting for approval token from the agent...
          </p>
        )}
        {requestId && (
          <p className="text-xs text-muted-foreground">
            request_id: <code>{requestId}</code>
          </p>
        )}
      </CardContent>
    </Card>
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
    <Badge
      variant="outline"
      className={
        tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : tone === "red"
            ? "border-red-200 bg-red-50 text-red-700"
            : tone === "amber"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : undefined
      }
    >
      {status}
    </Badge>
  );
}
