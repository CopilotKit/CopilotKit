import type {
  AbstractAgent,
  BaseEvent,
  ContentPart,
  Message,
  ToolMessage,
} from "@ag-ui/client";
import { z } from "zod";
import { adaptChildHistoryEvent } from "./child-history-claude-adapter";

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
export type ɵChildMessage = Message & {
  /** Ordered assistant media and text, retained alongside the AG-UI text fallback. */
  contentParts?: ContentPart[];
};

export interface ɵChildHistory {
  namespace: string[];
  name?: string;
  parentToolCallIds: string[];
  messages: ɵChildMessage[];
  /** Native live message IDs whose calls are also in the root event stream. */
  rootMessageIds: string[];
  /** Root turn observed when this child first arrived, for missing delegation calls. */
  anchorMessageId?: string;
}
export interface ɵChildHistorySnapshot {
  histories: readonly ɵChildHistory[];
  error?: string;
}
const EMPTY: ɵChildHistorySnapshot = { histories: [] };

function toMessages(history: z.infer<typeof historySchema>): ɵChildMessage[] {
  const messages: ɵChildMessage[] = [];
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
          if (
            block.unresolvedRef !== undefined ||
            (block.source?.type === "url" &&
              !/^https?:\/\//i.test(block.source.value))
          )
            parts.push({
              type: "text",
              text: `[Unavailable attachment: ${block.filename ?? block.unresolvedRef ?? "Unsupported URL"}]`,
            });
          else {
            // A source's MIME describes its bytes; block MIME fills in older
            // snapshots that stored this metadata only on the media block.
            const declaredMime = block.source?.mimeType ?? block.mimeType;
            const mime = declaredMime ?? "application/octet-stream";
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
              source: block.source
                ? {
                    ...block.source,
                    ...(declaredMime ? { mimeType: declaredMime } : {}),
                  }
                : {
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
        // AG-UI assistant content is text. Keep its Markdown fallback, with
        // ordered structured parts for child renderers that support media.
        const assistantContent =
          typeof content === "string"
            ? content
            : content
                .map((part) => {
                  if (part.type === "text") return part.text;
                  const label = String(
                    part.metadata?.filename ?? part.type,
                  ).replace(/[[\]\\]/g, "\\$&");
                  if (part.source.type === "data") return `[${label}]`;
                  if (part.source.type === "file")
                    return `[${label}: ${part.source.value}]`;
                  const url = part.source.value;
                  return `${part.type === "image" ? "!" : ""}[${label}](<${url.replace(/[<>\r\n]/g, encodeURIComponent)}>)`;
                })
                .join("");
        if (parts.length || toolCalls.length)
          messages.push({
            id,
            role: "assistant",
            content: assistantContent,
            ...(typeof content === "string" ? {} : { contentParts: content }),
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
  const unique = new Map<string, ɵChildMessage>();
  const seen = new Set<string>();
  for (const message of messages) {
    const key = JSON.stringify([
      message.id,
      message.role,
      message.role === "tool" ? message.toolCallId : null,
    ]);
    const fingerprint = JSON.stringify(message);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const prior = unique.get(key);
    if (prior?.role === "assistant" && message.role === "assistant") {
      if (JSON.stringify(prior) === JSON.stringify(message)) continue;
      const calls = new Map(
        [...(prior.toolCalls ?? []), ...(message.toolCalls ?? [])].map((c) => [
          c.id,
          c,
        ]),
      );
      unique.set(key, {
        ...prior,
        content: (prior.content ?? "") + (message.content ?? ""),
        ...(calls.size ? { toolCalls: [...calls.values()] } : {}),
        ...(prior.contentParts || message.contentParts
          ? {
              contentParts: [
                ...(prior.contentParts ??
                  (prior.content
                    ? [{ type: "text" as const, text: prior.content }]
                    : [])),
                ...(message.contentParts ??
                  (message.content
                    ? [{ type: "text" as const, text: message.content }]
                    : [])),
              ],
            }
          : {}),
      });
    } else unique.set(key, message);
  }
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
  agent: AbstractAgent;
  snapshot: ɵChildHistorySnapshot;
  chunks: Chunk[];
  lastChunk?: Chunk;
  bytes: number;
  live: Map<
    string,
    {
      parent: string;
      messageId: string;
      messages: ɵChildMessage[];
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
        agent,
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
    const owners = new Map<string, ɵChildHistory | null>();
    for (const history of histories)
      for (const parent of history.parentToolCallIds)
        for (const message of history.messages)
          if (message.role === "assistant")
            for (const call of message.toolCalls ?? []) {
              const key = JSON.stringify([parent, call.id]);
              const previous = owners.get(key);
              owners.set(
                key,
                previous === undefined || previous === history ? history : null,
              );
            }
    const results = new Map<ɵChildHistory, Map<string, ToolMessage>>();
    for (const [key, { result }] of data.results) {
      const owner = owners.get(key);
      if (!owner) continue;
      const owned = results.get(owner) ?? new Map<string, ToolMessage>();
      owned.set(result.toolCallId, result);
      results.set(owner, owned);
    }
    histories = histories.map((history) => {
      const owned = results.get(history);
      return owned
        ? {
            ...history,
            messages: [
              ...history.messages.filter(
                (m) => m.role !== "tool" || !owned.has(m.toolCallId),
              ),
              ...owned.values(),
            ],
          }
        : history;
    });
    const previousAnchors = new Map(
      data.snapshot.histories.map((h) => [
        JSON.stringify(h.namespace),
        h.anchorMessageId,
      ]),
    );
    const currentTurn = data.agent.messages
      .filter((m) => m.role === "user")
      .at(-1)?.id;
    histories = histories.map((h) => ({
      ...h,
      anchorMessageId:
        h.anchorMessageId ??
        previousAnchors.get(JSON.stringify(h.namespace)) ??
        currentTurn,
    }));
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
    // Resolve ownership once, rather than rescanning every sibling for every record.
    const owners = new Map<string, ɵChildHistory | null>();
    for (const history of histories)
      for (const parent of new Set(history.parentToolCallIds))
        owners.set(parent, owners.has(parent) ? null : history);
    const byHistory = new Map<
      ɵChildHistory,
      Array<
        [string, ThreadData["live"] extends Map<string, infer V> ? V : never]
      >
    >();
    for (const entry of data.live) {
      const owner = owners.get(entry[1].parent);
      if (!owner) continue;
      const entries = byHistory.get(owner) ?? [];
      entries.push(entry);
      byHistory.set(owner, entries);
    }
    return histories.map((h) => {
      const owned = byHistory.get(h) ?? [];
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
    const e = adaptChildHistoryEvent(object(event));
    if (e.type === "CUSTOM" && e.name === "cpki.child_histories") {
      const data = this.data(agent, threadId);
      try {
        const value = object(e.value);
        let raw: unknown;
        if (value.version === 1) {
          raw = value.histories;
          data.lastChunk = undefined;
        } else if (value.version === 2) {
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
          data.bytes += new TextEncoder().encode(chunk.data).byteLength;
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
        } else {
          console.warn(
            "Ignoring unsupported child history version",
            value.version,
          );
          return;
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
        console.warn("Unable to display saved child history", error);
        data.lastChunk = undefined;
        data.chunks = [];
        data.bytes = 0;
        data.snapshot = {
          ...data.snapshot,
          error:
            "Unable to display saved child history. Please reload to try again.",
        };
        this.emit();
      }
      return;
    }
    if (e.type === "CUSTOM" && e.name === "cpki.child_assistant_content") {
      const value = object(e.value);
      if (
        typeof value.parentToolUseId !== "string" ||
        typeof value.messageId !== "string" ||
        !Array.isArray(value.content)
      )
        return;
      const parsed = normalizedMessage.shape.content.safeParse(value.content);
      if (!parsed.success) return;
      const content = parsed.data;
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
        console.warn(
          "Unable to display saved child history: incomplete snapshot",
        );
        pending.lastChunk = undefined;
        pending.chunks = [];
        pending.bytes = 0;
        pending.snapshot = {
          ...pending.snapshot,
          error:
            "Unable to display saved child history. Please reload to try again.",
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
          metadata.source !== "cpki.child" ||
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
                      name: metadata.toolName,
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
      const parent = object(e.childHistory).parentToolCallId;
      if (typeof parent !== "string") return;
      const data = this.data(agent, threadId);
      const result = {
        id: e.messageId,
        role: "tool",
        toolCallId: e.toolCallId,
        content: e.content,
        ...(object(e.childHistory).isError === true
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
