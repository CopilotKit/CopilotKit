/**
 * A fine-tuning dataset preview built from captured trajectories: each example
 * is the user's request followed by the CORRECTED tool sequence (the exception
 * workflows the person ran by hand, expressed as the agent's tool calls), in OpenAI
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
  const total = f.autoMatched + f.exceptions.length;
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
  let n = 0;
  const step = (
    path: string,
    method: string,
    body: unknown,
    reply: unknown,
  ) => {
    const id = `w${++n}`;
    m.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [api(id, method, path, body)],
      },
      { role: "tool", tool_call_id: id, content: JSON.stringify(reply) },
    );
  };
  f.exceptions.forEach((x, i) => {
    const r = x.resolution;
    if (x.kind === "split" && r?.kind === "split") {
      const al = `AL-${4200 + i}`;
      step(
        "/allocations",
        "POST",
        { transactionId: x.transactionId },
        { id: al, status: "draft" },
      );
      step(
        `/allocations/${al}/lines`,
        "PUT",
        { lines: r.lines },
        { id: al, lines: r.lines },
      );
      step(`/allocations/${al}/commit`, "POST", undefined, {
        id: al,
        status: "committed",
      });
    } else if (x.kind === "reclass" && r?.kind === "reclass") {
      step(
        "/journal/reclasses",
        "POST",
        {
          transactionId: x.transactionId,
          fromAccount: r.fromAccount,
          toAccount: r.toAccount,
          memo: r.memo ?? "Software subscription, not meals.",
        },
        { entryId: `JE-${4300 + i}`, status: "posted" },
      );
    } else if (x.kind === "personal") {
      step(
        "/repayments",
        "POST",
        { transactionId: x.transactionId, method: "payroll_deduction" },
        { repaymentId: `RP-${4400 + i}`, status: "scheduled" },
      );
    } else if (x.kind === "missing_receipt") {
      step(
        "/affidavits",
        "POST",
        {
          transactionId: x.transactionId,
          memo:
            (r?.kind === "missing_receipt" ? r.memo : undefined) ??
            "Business travel, receipt not issued.",
        },
        { affidavitId: `AF-${4500 + i}`, status: "attested" },
      );
    }
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
      content: JSON.stringify({ valid: total, total }),
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
      content: `${f.holder}'s ${f.periodLabel} close is ready: receipts auto-matched and all ${f.exceptions.length} exceptions cleared. It is in the review card for your confirmation; nothing closes until you confirm.`,
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
    `Close out ${f.holder}'s ${f.periodLabel} card.`;
  const meta = (variant: string) => ({
    sourceTrajectoryId: f.trajectoryId,
    sourceEventIds: [
      f.evidence.session,
      ...f.evidence.workflowCalls,
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
      `Clear the exceptions on ${f.holder}'s card for ${f.periodLabel}.`,
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
