/**
 * A fine-tuning dataset preview built from captured trajectories: each example
 * is the user's request followed by the CORRECTED tool sequence (the one the
 * person performed by hand, expressed as the agent's tool calls), in OpenAI
 * chat format with tool calls. Nothing is uploaded; export is the JSONL.
 */

import type { TrajectoryDetail } from "./types";
import { extractFacts } from "./learn";
import type { Facts } from "./learn";
import { SKILL_NAME } from "./types";

export type FineTuneTarget = "thinking-machines" | "sagemaker";

export interface FineTuneExample {
  messages: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

const SYSTEM =
  "You are the Ledgerline assistant. Use the tools to prepare month-end card closes; the user confirms every close.";

function call(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

/** The corrected run: the recipe the person followed, as the agent's tool calls. */
function exampleFor(
  request: string,
  f: Facts,
  meta: Record<string, unknown>,
): FineTuneExample {
  const session = `rs_${f.last4}_${f.period.slice(5)}_001`;
  const api = (id: string, method: string, path: string, body?: unknown) =>
    call(
      id,
      "ledgerlineApi",
      body === undefined ? { method, path } : { method, path, body },
    );
  const m: Record<string, unknown>[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: request },
    {
      role: "assistant",
      content: null,
      tool_calls: [call("c0", "loadLearnedSkill", { name: SKILL_NAME })],
    },
    {
      role: "tool",
      tool_call_id: "c0",
      content: JSON.stringify({ name: SKILL_NAME, loaded: true }),
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        api("c1", "POST", "/reconciliation/sessions", {
          period: f.period,
          cardId: f.cardId,
        }),
      ],
    },
    {
      role: "tool",
      tool_call_id: "c1",
      content: JSON.stringify({ id: session, status: "open" }),
    },
  ];
  f.pairs.forEach((p, i) => {
    const id = `p${i + 1}`;
    m.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [
          api(id, "POST", `/reconciliation/sessions/${session}/pairs`, {
            transactionId: p.transactionId,
            receiptIds: p.receipts.map((r) => r.id),
            ...(p.adjustment ? { adjustment: p.adjustment } : {}),
          }),
        ],
      },
      {
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify({ id: session, status: "open" }),
      },
    );
  });
  m.push(
    {
      role: "assistant",
      content: null,
      tool_calls: [
        api("c2", "POST", `/reconciliation/sessions/${session}/validate`),
      ],
    },
    {
      role: "tool",
      tool_call_id: "c2",
      content: JSON.stringify({ valid: f.pairs.length, total: f.pairs.length }),
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [call("c3", "reviewMatches", { sessionId: session })],
    },
    {
      role: "tool",
      tool_call_id: "c3",
      content: JSON.stringify({ closed: true }),
    },
    {
      role: "assistant",
      content: `All ${f.pairs.length} of ${f.holder}'s ${f.periodLabel} charges are matched and valid. They are in the review card for your confirmation; nothing closes until you confirm.`,
    },
  );
  return { messages: m, metadata: meta };
}

export function buildExamples(d: TrajectoryDetail | null): FineTuneExample[] {
  if (!d) return [];
  let f: Facts;
  try {
    f = extractFacts(d);
  } catch {
    return [];
  }
  const userAsk =
    d.threads.flatMap((t) => t.messages).find((m) => m.role === "user")?.text ??
    `Match the unmatched transactions on ${f.holder}'s card to their receipts.`;
  const meta = (variant: string) => ({
    sourceTrajectoryId: f.trajectoryId,
    sourceEventIds: [
      f.evidence.session,
      ...f.evidence.pairCalls,
      f.evidence.passedValidation,
      f.evidence.closed,
    ]
      .filter(Boolean)
      .map((e) => e!.eventId),
    variant,
  });
  return [
    exampleFor(userAsk, f, meta("captured request")),
    exampleFor(
      `Reconcile ${f.holder}'s card for ${f.periodLabel}.`,
      f,
      meta("paraphrase"),
    ),
    exampleFor(
      `Can you get the ${f.periodLabel} close done for Visa ${f.last4}?`,
      f,
      meta("card number"),
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
