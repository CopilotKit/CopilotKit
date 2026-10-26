import type {
  AbstractAgent,
  BaseEvent,
  ContentPart,
  Message,
  ToolMessage,
} from "@ag-ui/client";
import { z } from "zod";

const text = z.object({ type: z.literal("text"), text: z.string() });
const reasoning = z.object({ type: z.literal("reasoning"), text: z.string() });
const call = z.object({
  type: z.literal("tool_call"),
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
});
const media = z
  .object({
    type: z.literal("media"),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    dataBase64: z.string().optional(),
    unresolvedRef: z.string().optional(),
    modality: z.enum(["image", "document", "audio", "video"]).optional(),
    source: z
      .object({
        type: z.enum(["url", "file"]),
        value: z.string(),
        mimeType: z.string().optional(),
        provider: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (b) =>
      !!b.source || b.dataBase64 !== undefined || b.unresolvedRef !== undefined,
  );
const normalizedMessage = z.object({
  sourceMessageId: z.string().nullable(),
  role: z.enum(["user", "assistant", "tool", "system", "developer"]),
  toolCallId: z.string().optional(),
  error: z.string().optional(),
  content: z.array(z.union([text, reasoning, call, media])),
});
const historySchema = z.object({
  namespace: z.array(z.string().min(1)).min(1).max(32),
  name: z.string().optional(),
  parentToolCallIds: z.array(z.string().min(1)).optional(),
  runs: z.array(
    z.object({ sourceRunId: z.string(), messages: z.array(normalizedMessage) }),
  ),
});
const historiesSchema = z.array(historySchema).superRefine((histories, ctx) => {
  const paths = new Set<string>();
  for (const history of histories) {
    const key = JSON.stringify(history.namespace);
    if (paths.has(key))
      ctx.addIssue({ code: "custom", message: "Duplicate child namespace" });
    paths.add(key);
  }
  for (const h of histories)
    if (
      h.namespace.length > 1 &&
      !paths.has(JSON.stringify(h.namespace.slice(0, -1)))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Missing parent child namespace",
      });
    }
});
const chunkSchema = z.object({
  version: z.literal(2),
  historyIndex: z.number().int().nonnegative(),
  historyCount: z.number().int().positive(),
  chunkIndex: z.number().int().nonnegative(),
  chunkCount: z.number().int().positive(),
  data: z.string().max(16 * 1024),
});
type Chunk = z.infer<typeof chunkSchema>;

/** Presentation-only messages. These must never be assigned to agent.messages. */
export interface ɵChildHistory {
  namespace: string[];
  name?: string;
  parentToolCallIds: string[];
  messages: Message[];
  /** Native live message IDs whose calls are also in the root event stream. */
  rootMessageIds: string[];
}
export interface ɵChildHistorySnapshot {
  histories: readonly ɵChildHistory[];
  error?: string;
}
const EMPTY: ɵChildHistorySnapshot = { histories: [] };

function toMessages(history: z.infer<typeof historySchema>): Message[] {
  const messages: Message[] = [];
  history.runs.forEach((run) =>
    run.messages.forEach((message, index) => {
      const id =
        message.sourceMessageId ?? JSON.stringify([run.sourceRunId, index]);
      const parts: ContentPart[] = [];
      const toolCalls: NonNullable<
        Extract<Message, { role: "assistant" }>["toolCalls"]
      > = [];
      message.content.forEach((block, blockIndex) => {
        if (block.type === "text") parts.push(block);
        if (block.type === "reasoning")
          messages.push({
            id: `${id}:reasoning:${blockIndex}`,
            role: "reasoning",
            content: block.text,
          });
        if (block.type === "tool_call")
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.args ?? {}),
            },
          });
        if (block.type === "media") {
          if (block.unresolvedRef !== undefined)
            parts.push({
              type: "text",
              text: `[Unavailable attachment: ${block.filename ?? block.unresolvedRef}]`,
            });
          else {
            const mime =
              block.mimeType ??
              block.source?.mimeType ??
              "application/octet-stream";
            const type =
              block.modality ??
              (mime.startsWith("image/")
                ? "image"
                : mime.startsWith("audio/")
                  ? "audio"
                  : mime.startsWith("video/")
                    ? "video"
                    : "document");
            parts.push({
              type,
              source: block.source ?? {
                type: "data",
                value: block.dataBase64!,
                mimeType: mime,
              },
              ...(block.filename
                ? { metadata: { filename: block.filename } }
                : {}),
            });
          }
        }
      });
      const content = parts.every((p) => p.type === "text")
        ? parts.map((p) => (p.type === "text" ? p.text : "")).join("")
        : parts;
      if (message.role === "tool") {
        if (message.toolCallId)
          messages.push({
            id,
            role: "tool",
            toolCallId: message.toolCallId,
            content,
            ...(message.error ? { error: message.error } : {}),
          });
      } else if (message.role === "assistant") {
        // AG-UI assistant content is text. Keep media as Markdown references;
        // user/tool messages retain their structured content parts.
        const assistantContent =
          typeof content === "string"
            ? content
            : content
                .map((part) => {
                  if (part.type === "text") return part.text;
                  const label = String(
                    part.metadata?.filename ?? part.type,
                  ).replace(/[[\]\\]/g, "\\$&");
                  if (part.source.type === "file")
                    return `[${label}: ${part.source.value}]`;
                  const url =
                    part.source.type === "data"
                      ? `data:${part.source.mimeType};base64,${part.source.value}`
                      : part.source.value;
                  return `${part.type === "image" ? "!" : ""}[${label}](<${url.replace(/[<>\r\n]/g, encodeURIComponent)}>)`;
                })
                .join("");
        if (parts.length || toolCalls.length)
          messages.push({
            id,
            role: "assistant",
            content: assistantContent,
            ...(toolCalls.length ? { toolCalls } : {}),
          });
      } else if (message.role === "user")
        messages.push({ id, role: "user", content });
      else
        messages.push({
          id,
          role: message.role,
          content:
            typeof content === "string"
              ? content
              : content
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join(""),
        });
    }),
  );
  // Native records may share a UUID across several results and a user text
  // block. Only repeated context for the same role/call is a duplicate.
  const unique = new Map(
    messages.map((m) => [
      JSON.stringify([m.id, m.role, m.role === "tool" ? m.toolCallId : null]),
      m,
    ]),
  );
  const ids = new Set<string>();
  return [...unique.values()].map((message) => {
    let id = message.id;
    while (ids.has(id))
      id += `:${message.role}${message.role === "tool" ? `:${message.toolCallId}` : ""}`;
    ids.add(id);
    return id === message.id ? message : { ...message, id };
  });
}

interface ThreadData {
  snapshot: ɵChildHistorySnapshot;
  chunks: Chunk[];
  lastChunk?: Chunk;
  bytes: number;
  live: Map<
    string,
    {
      parent: string;
      messageId: string;
      messages: Message[];
      records: Map<string, z.infer<typeof normalizedMessage>["content"]>;
    }
  >;
  results: Map<string, { parent: string; result: ToolMessage }>;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** Retains imported history and owned live completions independently of model input. */
export class ɵChildHistoryStore {
  private agents = new WeakMap<AbstractAgent, Map<string, ThreadData>>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get(agent: AbstractAgent, threadId: string): ɵChildHistorySnapshot {
    return this.agents.get(agent)?.get(threadId)?.snapshot ?? EMPTY;
  }
  clear(agent: AbstractAgent, threadId?: string) {
    if (threadId === undefined) this.agents.delete(agent);
    else this.agents.get(agent)?.delete(threadId);
    this.emit();
  }
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  private data(agent: AbstractAgent, threadId: string): ThreadData {
    let threads = this.agents.get(agent);
    if (!threads) {
      threads = new Map();
      this.agents.set(agent, threads);
    }
    let data = threads.get(threadId);
    if (!data) {
      data = {
        snapshot: EMPTY,
        chunks: [],
        bytes: 0,
        live: new Map(),
        results: new Map(),
      };
      threads.set(threadId, data);
    }
    return data;
  }
  private publish(
    data: ThreadData,
    histories: ɵChildHistory[],
    clearError = false,
  ) {
    for (const { parent, result } of data.results.values()) {
      const owners = histories.filter(
        (h) =>
          h.parentToolCallIds.includes(parent) &&
          h.messages.some(
            (m) =>
              m.role === "assistant" &&
              m.toolCalls?.some((c) => c.id === result.toolCallId),
          ),
      );
      if (owners.length === 1)
        histories = histories.map((h) =>
          h !== owners[0]
            ? h
            : {
                ...h,
                messages: [
                  ...h.messages.filter(
                    (m) =>
                      m.role !== "tool" || m.toolCallId !== result.toolCallId,
                  ),
                  result,
                ],
              },
        );
    }
    data.snapshot = {
      histories,
      ...(!clearError && data.snapshot.error
        ? { error: data.snapshot.error }
        : {}),
    };
    this.emit();
  }
  private mergeLive(
    data: ThreadData,
    histories: ɵChildHistory[],
  ): ɵChildHistory[] {
    return histories.map((h) => {
      const owned = [...data.live.entries()].filter(
        ([, live]) =>
          h.parentToolCallIds.includes(live.parent) &&
          histories.filter((candidate) =>
            candidate.parentToolCallIds.includes(live.parent),
          ).length === 1,
      );
      if (!owned.length) return h;
      const messages = new Map(h.messages.map((m) => [m.id, m]));
      for (const [, live] of owned)
        for (const message of live.messages) {
          // A native SDK message can be re-keyed after import. Tool identity is stable.
          if (message.role === "assistant" && message.toolCalls?.length) {
            const ids = new Set(message.toolCalls.map((c) => c.id));
            for (const [key, old] of messages)
              if (
                key !== message.id &&
                old.role === "assistant" &&
                old.toolCalls?.some((c) => ids.has(c.id))
              ) {
                const remaining = old.toolCalls.filter((c) => !ids.has(c.id));
                if (!remaining.length && !old.content) messages.delete(key);
                else messages.set(key, { ...old, toolCalls: remaining });
              }
          }
          messages.set(message.id, message);
        }
      return {
        ...h,
        messages: [...messages.values()],
        rootMessageIds: [
          ...new Set([
            ...h.rootMessageIds,
            ...owned.map(([, live]) => live.messageId),
          ]),
        ],
      };
    });
  }
  accept(agent: AbstractAgent, threadId: string, event: BaseEvent): void {
    const e = object(event);
    if (e.type === "CUSTOM" && e.name === "cpki.child_histories") {
      const data = this.data(agent, threadId);
      try {
        const value = object(e.value);
        let raw: unknown;
        if (value.version === 1) {
          raw = value.histories;
          data.lastChunk = undefined;
        } else {
          const chunk = chunkSchema.parse(value);
          // An event may be delivered by both a replay and a live subscriber.
          // An identical retransmission is not a missing/out-of-order chunk.
          if (
            data.lastChunk &&
            JSON.stringify(data.lastChunk) === JSON.stringify(chunk)
          )
            return;
          data.lastChunk = chunk;
          if (chunk.historyIndex === 0 && chunk.chunkIndex === 0) {
            data.chunks = [];
            data.bytes = 0;
          }
          data.bytes += chunk.data.length;
          if (data.bytes > 32 * 1024 * 1024)
            throw new Error("Child snapshot exceeds 32 MiB");
          const previous = data.chunks.at(-1);
          const expectedHistory = previous
            ? previous.historyIndex +
              (previous.chunkIndex + 1 === previous.chunkCount ? 1 : 0)
            : 0;
          const expectedChunk =
            previous && expectedHistory === previous.historyIndex
              ? previous.chunkIndex + 1
              : 0;
          if (
            chunk.historyIndex !== expectedHistory ||
            chunk.chunkIndex !== expectedChunk ||
            (previous && chunk.historyCount !== previous.historyCount) ||
            (previous &&
              expectedChunk > 0 &&
              chunk.chunkCount !== previous.chunkCount) ||
            chunk.chunkIndex >= chunk.chunkCount ||
            chunk.historyIndex >= chunk.historyCount
          )
            throw new Error(
              `Incomplete or conflicting child snapshot (expected ${expectedHistory}/${expectedChunk}, received ${chunk.historyIndex}/${chunk.chunkIndex})`,
            );
          data.chunks.push(chunk);
          if (
            chunk.historyIndex + 1 !== chunk.historyCount ||
            chunk.chunkIndex + 1 !== chunk.chunkCount
          )
            return;
          const histories: unknown[] = [];
          let parts: string[] = [];
          for (const part of data.chunks) {
            parts.push(part.data);
            if (part.chunkIndex + 1 === part.chunkCount) {
              histories.push(JSON.parse(parts.join("")));
              parts = [];
            }
          }
          raw = histories;
        }
        const histories = historiesSchema.parse(raw).map((h) => ({
          namespace: h.namespace,
          name: h.name,
          parentToolCallIds: h.parentToolCallIds ?? [],
          messages: toMessages(h),
          rootMessageIds: [],
        }));
        data.chunks = [];
        data.bytes = 0;
        this.publish(data, this.mergeLive(data, histories), true);
      } catch (error) {
        data.lastChunk = undefined;
        data.chunks = [];
        data.bytes = 0;
        data.snapshot = {
          ...data.snapshot,
          error: `Unable to display saved child history: ${error instanceof Error ? error.message : String(error)}`,
        };
        this.emit();
      }
      return;
    }
    if (e.type === "CUSTOM" && e.name === "claude:assistant_content") {
      const value = object(e.value);
      if (
        typeof value.parentToolUseId !== "string" ||
        typeof value.messageId !== "string" ||
        !Array.isArray(value.content)
      )
        return;
      const content = value.content.flatMap(
        (raw): z.infer<typeof normalizedMessage>["content"] => {
          const b = object(raw);
          if (b.type === "text" && typeof b.text === "string")
            return [{ type: "text", text: b.text }];
          if (b.type === "thinking" && typeof b.thinking === "string")
            return [{ type: "reasoning", text: b.thinking }];
          if (
            b.type === "tool_use" &&
            typeof b.id === "string" &&
            typeof b.name === "string"
          )
            return [
              {
                type: "tool_call",
                id: b.id,
                name: b.name.replace(/^mcp__ag_ui__/, ""),
                args: b.input,
              },
            ];
          return [];
        },
      );
      const data = this.data(agent, threadId);
      const liveKey = JSON.stringify([value.parentToolUseId, value.messageId]);
      const prior = data.live.get(liveKey);
      const records =
        prior?.records ??
        new Map<string, z.infer<typeof normalizedMessage>["content"]>();
      records.set(
        typeof value.uuid === "string" ? value.uuid : "snapshot",
        content,
      );
      const messages = toMessages({
        namespace: ["live"],
        runs: [
          {
            sourceRunId: "live",
            messages: [
              {
                sourceMessageId: value.messageId,
                role: "assistant",
                content: [...records.values()].flat(),
              },
            ],
          },
        ],
      });
      data.live.set(liveKey, {
        parent: value.parentToolUseId,
        messageId: value.messageId,
        messages,
        records,
      });
      this.publish(data, this.mergeLive(data, [...data.snapshot.histories]));
      return;
    }
    if (e.type === "RUN_FINISHED") {
      const pending = this.agents.get(agent)?.get(threadId);
      if (pending?.chunks.length) {
        pending.lastChunk = undefined;
        pending.chunks = [];
        pending.bytes = 0;
        pending.snapshot = {
          ...pending.snapshot,
          error: "Unable to display saved child history: incomplete snapshot",
        };
        this.emit();
      }
      const outcome = object(e.outcome);
      if (outcome.type !== "interrupt" || !Array.isArray(outcome.interrupts))
        return;
      const data = this.data(agent, threadId);
      let histories = [...data.snapshot.histories];
      for (const raw of outcome.interrupts) {
        const interrupt = object(raw),
          metadata = object(interrupt.metadata);
        if (
          metadata.source !== "claude-sdk-native-child" ||
          typeof metadata.childId !== "string" ||
          metadata.childId.length === 0 ||
          typeof metadata.parentToolUseId !== "string" ||
          metadata.parentToolUseId.length === 0 ||
          typeof metadata.toolName !== "string" ||
          typeof interrupt.id !== "string"
        )
          continue;
        const matches = histories.filter(
          (h) =>
            h.namespace.at(-1) === metadata.childId &&
            h.parentToolCallIds.includes(metadata.parentToolUseId as string),
        );
        if (matches.length > 1) continue;
        let history = matches[0];
        if (!history) {
          const parents = histories.filter((h) =>
            h.messages.some(
              (m) =>
                m.role === "assistant" &&
                m.toolCalls?.some((c) => c.id === metadata.parentToolUseId),
            ),
          );
          if (parents.length > 1) continue;
          const namespace = [
            ...(parents[0]?.namespace ?? []),
            metadata.childId,
          ];
          const previous = histories.find(
            (h) => JSON.stringify(h.namespace) === JSON.stringify(namespace),
          );
          const resumedHistory: ɵChildHistory = previous
            ? {
                ...previous,
                parentToolCallIds: [
                  ...new Set([
                    ...previous.parentToolCallIds,
                    metadata.parentToolUseId,
                  ]),
                ],
              }
            : {
                namespace,
                parentToolCallIds: [metadata.parentToolUseId],
                messages: [],
                rootMessageIds: [],
              };
          histories = previous
            ? histories.map((h) => (h === previous ? resumedHistory : h))
            : [...histories, resumedHistory];
          history = resumedHistory;
        }
        if (
          !history.messages.some(
            (m) =>
              m.role === "assistant" &&
              m.toolCalls?.some((c) => c.id === interrupt.id),
          )
        ) {
          const updated = {
            ...history,
            messages: [
              ...history.messages,
              {
                id: `interrupt:${interrupt.id}`,
                role: "assistant" as const,
                toolCalls: [
                  {
                    id: interrupt.id,
                    type: "function" as const,
                    function: {
                      name: metadata.toolName.replace(/^mcp__ag_ui__/, ""),
                      arguments: JSON.stringify(metadata.input ?? {}),
                    },
                  },
                ],
              },
            ],
          };
          histories = histories.map((h) => (h === history ? updated : h));
        }
      }
      this.publish(data, this.mergeLive(data, histories));
      return;
    }
    if (e.type === "TOOL_CALL_RESULT") {
      const parent = object(e.rawEvent).parent_tool_use_id;
      if (typeof parent !== "string") return;
      const data = this.data(agent, threadId);
      const result = {
        id: e.messageId,
        role: "tool",
        toolCallId: e.toolCallId,
        content: e.content,
        ...(object(e.rawEvent).is_error === true
          ? { error: "Tool execution failed" }
          : {}),
      } as ToolMessage;
      data.results.set(JSON.stringify([parent, e.toolCallId]), {
        parent,
        result,
      });
      const owners = data.snapshot.histories.filter(
        (h) =>
          h.parentToolCallIds.includes(parent) &&
          h.messages.some(
            (m) =>
              m.role === "assistant" &&
              m.toolCalls?.some((c) => c.id === e.toolCallId),
          ),
      );
      if (owners.length !== 1) return;
      this.publish(data, [...data.snapshot.histories]);
    }
  }
}
