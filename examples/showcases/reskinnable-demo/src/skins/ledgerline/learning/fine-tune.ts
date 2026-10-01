/**
 * A fine-tuning dataset preview built from captured trajectories: each example
 * is the user's request followed by the CORRECTED tool sequence (the one the
 * person performed by hand, expressed as the agent's tool calls), in OpenAI
 * chat format with tool calls. Nothing is uploaded; export is the JSONL.
 */

import type { TrajectoryDetail } from "./types";
import { extractFacts } from "./learn";

export type FineTuneTarget = "thinking-machines" | "sagemaker";

export interface FineTuneExample {
  messages: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

const SYSTEM =
  "You are the Ledgerline expense assistant. Use the tools to read, approve and reimburse expense reports.";

function call(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

type Lines = { recoded: { lineId: string }[]; kept: { lineId: string }[] };

function exampleFor(
  request: string,
  reportId: string,
  costCenterId: string,
  lines: Lines,
  amount: number | undefined,
  reimburse: boolean,
  meta: Record<string, unknown>,
): FineTuneExample {
  const m: Record<string, unknown>[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: request },
    {
      role: "assistant",
      content: null,
      tool_calls: [call("c1", "getReport", { reportId })],
    },
    {
      role: "tool",
      tool_call_id: "c1",
      content: JSON.stringify({
        id: reportId,
        category: "Team event",
        total: amount,
        holds: [
          { code: "POL-114", status: "open", label: "allocation required" },
        ],
        lines: [...lines.recoded, ...lines.kept].map((l) => ({
          lineId: l.lineId,
        })),
      }),
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        call("c2", "recodeLines", {
          reportId,
          lines: lines.recoded.map((l) => ({ lineId: l.lineId, costCenterId })),
        }),
      ],
    },
    {
      role: "tool",
      tool_call_id: "c2",
      content: JSON.stringify({
        id: reportId,
        lines: lines.recoded.map((l) => ({
          lineId: l.lineId,
          costCenter: { id: costCenterId },
        })),
        holds: [{ code: "POL-114", status: "resolved" }],
      }),
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [call("c3", "approveReport", { reportId })],
    },
    {
      role: "tool",
      tool_call_id: "c3",
      content: JSON.stringify({ id: reportId, status: "approved" }),
    },
  ];
  if (reimburse) {
    m.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [call("c4", "reimburseReport", { reportId })],
      },
      {
        role: "tool",
        tool_call_id: "c4",
        content: JSON.stringify({ id: reportId, status: "reimbursed" }),
      },
    );
  }
  m.push({
    role: "assistant",
    content: `Recoded the event lines of ${reportId} to ${costCenterId} Events & Offsites to clear hold POL-114, approved it${reimburse ? " and scheduled the reimbursement" : ""}.`,
  });
  return { messages: m, metadata: meta };
}

export function buildExamples(d: TrajectoryDetail | null): FineTuneExample[] {
  if (!d) return [];
  let f;
  try {
    f = extractFacts(d);
  } catch {
    return [];
  }
  const userAsk =
    d.threads.flatMap((t) => t.messages).find((m) => m.role === "user")?.text ??
    `Approve ${f.employee}'s ${f.reportId} report and reimburse them.`;
  const total = (
    d.events.find((e) => e.event.name === "screen.context")?.event.value
      .fields as Record<string, unknown> | undefined
  )?.total;
  const amount = typeof total === "number" ? total : undefined;
  const meta = (variant: string) => ({
    sourceTrajectoryId: f.trajectoryId,
    sourceEventIds: [
      f.evidence.policyView,
      f.evidence.costCentersView,
      f.evidence.recoded,
      f.evidence.approved,
      f.evidence.reimbursed,
    ]
      .filter(Boolean)
      .map((e) => e!.eventId),
    variant,
  });
  return [
    exampleFor(
      userAsk,
      f.reportId,
      f.costCenterId,
      f,
      amount,
      true,
      meta("captured request"),
    ),
    exampleFor(
      `Approve ${f.reportId}.`,
      f.reportId,
      f.costCenterId,
      f,
      amount,
      false,
      meta("approve only"),
    ),
    exampleFor(
      `Can you get ${f.employee}'s team event report approved and paid out?`,
      f.reportId,
      f.costCenterId,
      f,
      amount,
      true,
      meta("paraphrase"),
    ),
  ];
}

/** Target-specific line shape. Both are chat-format JSONL; SageMaker keeps the system prompt separate. */
export function toTarget(
  target: FineTuneTarget,
  ex: FineTuneExample,
): Record<string, unknown> {
  if (target === "sagemaker") {
    const [system, ...rest] = ex.messages;
    return { system: (system as { content?: string }).content, messages: rest };
  }
  return { messages: ex.messages };
}

export function preview(target: FineTuneTarget, d: TrajectoryDetail | null) {
  const examples = buildExamples(d).map((e) => toTarget(target, e));
  return {
    target,
    format: "jsonl",
    examples: examples.length,
    sample: examples,
  };
}

export function jsonl(
  target: FineTuneTarget,
  d: TrajectoryDetail | null,
): string {
  return buildExamples(d)
    .map((e) => JSON.stringify(toTarget(target, e)))
    .join("\n");
}
