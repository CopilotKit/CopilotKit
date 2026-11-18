/**
 * AG-UI event streams for a trajectory's Threads.
 *
 * The learning store keeps each Thread as messages plus a summarized agent trace.
 * This rebuilds, from that record, the AG-UI event stream a run emits
 * (`@ag-ui/core` event types and field names: RUN_STARTED, STATE_SNAPSHOT,
 * THINKING_*, TOOL_CALL_START / ARGS / END, TOOL_CALL_RESULT, TEXT_MESSAGE_*,
 * MESSAGES_SNAPSHOT, RUN_FINISHED), in order, with ids and timestamps.
 *
 * ChatGPT Threads come in over MCP, not AG-UI. Each MCP `tools/call` is mapped to
 * the same TOOL_CALL_* events, with the original JSON-RPC call in `rawEvent` and
 * `rawEvent.source: "mcp"`, so the trajectory view reads one shape.
 *
 * Product events are already AG-UI CUSTOM events and pass through unchanged.
 * Pure and deterministic: the same record gives the same stream.
 */
import type {
  TraceStep,
  TrajectoryDetail,
  TrajectoryThread,
} from "../data/contract";

export interface AguiEnvelope {
  /** Position in the Thread's stream, from 1. */
  readonly seq: number;
  /** The trace step or message this event belongs to (view metadata, not part of the event). */
  readonly stepId: string;
  /** The AG-UI event, as `@ag-ui/core` defines it. */
  readonly event: Record<string, unknown> & { type: string; timestamp: number };
}

export type AguiThread = TrajectoryThread & {
  readonly aguiEvents: readonly AguiEnvelope[];
  readonly aguiSource: "ag-ui" | "mcp-mapped";
};

export type AguiTrajectory = Omit<TrajectoryDetail, "threads"> & {
  readonly format: "ag-ui.trajectory.v1";
  readonly threads: readonly AguiThread[];
};

/** Small stable hash, so ids look like the runtime's and never change between reads. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const uuidish = (seed: string): string => {
  const a = hash(seed);
  const b = hash(`${seed}:b`);
  const c = hash(`${seed}:c`);
  const d = hash(`${seed}:d`);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
};

/** Streams text the way a model does: a few deltas of a few words each. */
function chunks(text: string): string[] {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 8)
    out.push(words.slice(i, i + 8).join(""));
  return out.filter((s) => s.length > 0);
}

function argChunks(args: unknown): string[] {
  const text = JSON.stringify(args ?? {});
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 24) out.push(text.slice(i, i + 24));
  return out;
}

function threadStream(t: TrajectoryThread, userName: string): AguiEnvelope[] {
  const mcp = t.surface === "chatgpt";
  const out: AguiEnvelope[] = [];
  let seq = 0;
  const push = (
    stepId: string,
    event: Record<string, unknown> & { type: string; timestamp: number },
  ) => {
    seq += 1;
    out.push({ seq, stepId, event });
  };
  const times = [
    ...t.messages.map((m) => m.at),
    ...t.agentTrace.map((x) => x.at),
  ];
  const start = times.length ? Math.min(...times) : 0;
  const end = times.length ? Math.max(...times) : 0;
  const runId = uuidish(`${t.threadId}:run`);
  const firstUser = t.messages.find((m) => m.role === "user");
  const mcpRaw = (extra: Record<string, unknown>) =>
    mcp
      ? { rawEvent: { source: "mcp", transport: "streamable-http", ...extra } }
      : {};

  push("run", {
    type: "RUN_STARTED",
    threadId: t.threadId,
    runId,
    timestamp: start,
    ...mcpRaw({
      note: "ChatGPT calls Ledgerline over MCP; each tools/call is mapped to AG-UI TOOL_CALL_* events.",
    }),
  });
  if (!mcp) {
    push("run", {
      type: "STATE_SNAPSHOT",
      timestamp: start + 2,
      snapshot: { route: "/reports", user: userName, selectedReportId: null },
    });
  }

  for (const step of t.agentTrace as readonly TraceStep[]) {
    const at = step.at;
    if (step.kind === "thinking") {
      const messageId = `msg_${hash(`${t.threadId}:${step.id}:think`)}`;
      push(step.id, {
        type: "THINKING_START",
        timestamp: at,
        title: "Planning",
      });
      push(step.id, {
        type: "THINKING_TEXT_MESSAGE_START",
        timestamp: at + 1,
        messageId,
      });
      for (const [i, delta] of chunks(step.text ?? "").entries()) {
        push(step.id, {
          type: "THINKING_TEXT_MESSAGE_CONTENT",
          timestamp: at + 2 + i,
          messageId,
          delta,
        });
      }
      push(step.id, {
        type: "THINKING_TEXT_MESSAGE_END",
        timestamp: at + 40,
        messageId,
      });
      push(step.id, { type: "THINKING_END", timestamp: at + 41 });
      continue;
    }
    const toolCallId = `call_${hash(`${t.threadId}:${step.id}`)}${hash(step.id).slice(0, 4)}`;
    const parentMessageId = `msg_${hash(`${t.threadId}:${step.id}:parent`)}`;
    push(step.id, {
      type: "TOOL_CALL_START",
      timestamp: at,
      toolCallId,
      toolCallName: step.name ?? "tool",
      parentMessageId,
      ...mcpRaw({
        jsonrpc: "2.0",
        id: hash(toolCallId),
        method: "tools/call",
        params: { name: step.name, arguments: step.args ?? {} },
      }),
    });
    for (const [i, delta] of argChunks(step.args).entries()) {
      push(step.id, {
        type: "TOOL_CALL_ARGS",
        timestamp: at + 1 + i,
        toolCallId,
        delta,
      });
    }
    push(step.id, { type: "TOOL_CALL_END", timestamp: at + 12, toolCallId });
    push(step.id, {
      type: "TOOL_CALL_RESULT",
      timestamp: at + 12 + (step.durationMs ?? 0),
      messageId: `msg_${hash(`${toolCallId}:result`)}`,
      toolCallId,
      content: JSON.stringify(step.result ?? null),
      role: "tool",
      ...mcpRaw({
        jsonrpc: "2.0",
        id: hash(toolCallId),
        result: {
          isError: step.status === "error",
          content: [
            { type: "text", text: JSON.stringify(step.result ?? null) },
          ],
        },
      }),
    });
  }

  for (const m of t.messages.filter((x) => x.role === "assistant")) {
    const messageId = `msg_${hash(`${t.threadId}:${m.id}`)}`;
    push(m.id, {
      type: "TEXT_MESSAGE_START",
      timestamp: m.at - 30,
      messageId,
      role: "assistant",
    });
    for (const [i, delta] of chunks(m.text).entries()) {
      push(m.id, {
        type: "TEXT_MESSAGE_CONTENT",
        timestamp: m.at - 29 + i,
        messageId,
        delta,
      });
    }
    push(m.id, { type: "TEXT_MESSAGE_END", timestamp: m.at, messageId });
  }

  if (!mcp) {
    push("run", {
      type: "MESSAGES_SNAPSHOT",
      timestamp: end + 5,
      messages: [
        ...(firstUser
          ? [{ id: firstUser.id, role: "user", content: firstUser.text }]
          : []),
        ...t.agentTrace
          .filter((x) => x.kind === "tool.call")
          .map((x) => ({
            id: `msg_${hash(`${t.threadId}:${x.id}:parent`)}`,
            role: "assistant",
            toolCalls: [
              {
                id: `call_${hash(`${t.threadId}:${x.id}`)}${hash(x.id).slice(0, 4)}`,
                type: "function",
                function: {
                  name: x.name,
                  arguments: JSON.stringify(x.args ?? {}),
                },
              },
            ],
          })),
        ...t.messages
          .filter((x) => x.role === "assistant")
          .map((x) => ({
            id: `msg_${hash(`${t.threadId}:${x.id}`)}`,
            role: "assistant",
            content: x.text,
          })),
      ],
    });
  }
  push("run", {
    type: "RUN_FINISHED",
    threadId: t.threadId,
    runId,
    timestamp: end + 6,
    ...mcpRaw({}),
  });
  return out;
}

/** The trajectory with each Thread's AG-UI event stream added. */
export function withAguiEvents(detail: TrajectoryDetail): AguiTrajectory {
  return {
    ...detail,
    format: "ag-ui.trajectory.v1",
    threads: detail.threads.map((t) => ({
      ...t,
      aguiSource: t.surface === "chatgpt" ? "mcp-mapped" : "ag-ui",
      aguiEvents: threadStream(t, detail.trajectory.user.name),
    })),
  };
}
