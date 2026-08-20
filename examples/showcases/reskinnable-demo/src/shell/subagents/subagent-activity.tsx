"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  useAgent,
  UseAgentUpdate,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";

/**
 * Tracks what a run's SUBAGENTS are doing, from the live AG-UI event stream.
 *
 * ## Why events and not `agent.messages`
 *
 * Two facts, both measured against a real run, decide this:
 *
 * 1. **`agent.messages` materialises late.** A run emits ~3000 events but only
 *    TWO `MESSAGES_SNAPSHOT`s, so a consumer reading messages sits still for
 *    minutes and then fills in all at once at the end. Useless for a live
 *    console.
 * 2. **Only events carry attribution.** 2924 of 3064 events carried a
 *    `subagentRunId` — including 877 of 879 `TEXT_MESSAGE_CONTENT` deltas —
 *    while the PERSISTED messages carried it on none of 55. So the event stream
 *    is the only place you can tell a subagent's narration apart from the
 *    parent agent's.
 *
 * That second point is what makes this shell-level rather than a skin's private
 * concern: any skin whose agent delegates to subagents needs the same
 * distinction, and the tag says nothing about which skin produced it.
 *
 * ## What it exposes
 *
 * - `lines` — an ordered, streaming transcript of subagent activity, ready for a
 *   console to render.
 * - `subagentMessageIds` — the message ids a subagent produced, so the chat can
 *   decline to render them inline. Joined via `TEXT_MESSAGE_START`, which
 *   carries `messageId` AND `subagentRunId`; verified those ids match the
 *   persisted message ids exactly.
 * - `subagents` — the registry, with `parentSubagentRunId` so a nested
 *   hierarchy (analyst → researchers) can be shown as one.
 *
 * Requires the producer to have subagent emission ON (`emit_subagent_events`
 * on the Python side). With it off the stream carries no `subagentRunId` at all,
 * every collection here stays empty, and consumers degrade to showing nothing
 * rather than showing something wrong.
 */

export interface SubagentInfo {
  subagentRunId: string;
  name: string;
  parentSubagentRunId?: string;
  status: "running" | "finished" | "error";
}

export type SubagentLineKind =
  | "started"
  | "finished"
  | "text"
  | "tool"
  | "result";

export interface SubagentLine {
  key: string;
  kind: SubagentLineKind;
  subagentRunId: string;
  /** Resolved subagent name, when the registry knows it yet. */
  name?: string;
  /** Depth in the subagent tree — 0 for a top-level delegate. */
  depth: number;
  /**
   * For a tool line, the tool's name — so a consumer can decline to draw a tool
   * it renders as a COMPONENT elsewhere. Printing a report tool as a shell line
   * next to the card it produced shows the same thing twice.
   */
  toolName?: string;
  text: string;
  failed?: boolean;
}

interface SubagentActivity {
  lines: SubagentLine[];
  subagentMessageIds: ReadonlySet<string>;
  /**
   * Tool-call ids a SUBAGENT made, so the chat can decline to render them
   * inline. The parent agent's own tool calls are deliberately absent: they are
   * untagged on the wire, which is exactly what distinguishes "the parent
   * delegated" (worth a slot in the transcript) from "the harness ran a shell
   * command" (belongs in the console).
   */
  subagentToolCallIds: ReadonlySet<string>;
  subagents: ReadonlyMap<string, SubagentInfo>;
  isRunning: boolean;
}

const EMPTY: SubagentActivity = {
  lines: [],
  subagentMessageIds: new Set(),
  subagentToolCallIds: new Set(),
  subagents: new Map(),
  isRunning: false,
};

const SubagentActivityContext = createContext<SubagentActivity>(EMPTY);

export const useSubagentActivity = (): SubagentActivity =>
  useContext(SubagentActivityContext);

/**
 * The tool-call id of the run's FIRST delegation — a stable place to anchor a
 * single surface (a console, a progress panel) for the whole of a subagent run.
 *
 * Derived from MESSAGE ORDER, deliberately, not from the live event stream.
 * Anchoring on "a `task` call the events have not tagged as a subagent's" looks
 * equivalent and is not: the tag arrives asynchronously and, on a RESTORED
 * thread, never — `agent.subscribe` only sees a live run. The set is then empty,
 * every nested `task` call looks like the parent's, and the anchored surface
 * renders once per delegation. Measured: six consoles in one transcript.
 *
 * Message order has neither problem. The parent's delegation is always the
 * first `task` in the thread, before any subagent could have made one, and the
 * ordering is persisted rather than observed.
 */
export const useFirstDelegationToolCallId = (
  toolName = "task",
): string | undefined => {
  const { agent } = useAgent({
    updates: [UseAgentUpdate.OnMessagesChanged],
    throttleMs: 200,
  });
  const messages = agent?.messages;
  return useMemo(() => {
    for (const message of messages ?? []) {
      const m = message as {
        role?: string;
        toolCalls?: {
          id: string;
          function?: { name?: string };
          name?: string;
        }[];
      };
      if (m.role !== "assistant") continue;
      for (const call of m.toolCalls ?? []) {
        if ((call.function?.name ?? call.name) === toolName) return call.id;
      }
    }
    return undefined;
  }, [messages, toolName]);
};

// ── event shaping ───────────────────────────────────────────────────────────

const str = (v: unknown): string =>
  typeof v === "string" ? v : v == null ? "" : String(v);

const firstLine = (v: string): string => {
  const nl = v.indexOf("\n");
  return nl === -1 ? v : v.slice(0, nl);
};

/**
 * One line per tool call, shaped so a console reads like a terminal rather than
 * a log of function names. Argument shapes are taken from real runs: `execute`
 * carries `{command}` (often a heredoc), `write_file` `{file_path, content}`,
 * `task` `{subagent_type, description}`.
 */
const toolLine = (name: string, argsJson: string): string => {
  let a: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed && typeof parsed === "object")
      a = parsed as Record<string, unknown>;
  } catch {
    // Arguments STREAM, so a half-written JSON blob is the normal state of the
    // newest tool call rather than an error.
  }
  switch (name) {
    case "execute":
      return `$ ${firstLine(str(a.command).trim())}`;
    case "write_file":
      return `write ${str(a.file_path)} (${str(a.content).split("\n").length} lines)`;
    case "read_file":
      return `read ${str(a.file_path)}`;
    case "edit_file":
      return `edit ${str(a.file_path)}`;
    case "search_merchant":
      return `search "${str(a.query)}"`;
    case "task":
      return `→ ${str(a.subagent_type) || "subagent"}: ${firstLine(str(a.description).trim())}`;
    default:
      return name;
  }
};

const RESULT_MAX_CHARS = 200;

const resultLine = (raw: string): { text: string; failed: boolean } => {
  const failed =
    /exit code (?!0\b)\d+/.test(raw) || /\[Command failed/i.test(raw);
  let body = raw
    .replace(/\n?\[Command (?:succeeded|failed)[^\]]*\]\s*$/i, "")
    .trim();
  if (body.length > RESULT_MAX_CHARS)
    body = `${body.slice(0, RESULT_MAX_CHARS)}…`;
  return { text: body, failed };
};

/**
 * The event fold, as a PURE function over an accumulator.
 *
 * Extracted so the SAME logic serves two sources: the live subscription, and a
 * replay of the thread's persisted events when a thread is reopened. Those two
 * overlap during a live run — an event is streamed and stored — so the fold is
 * IDEMPOTENT: every line is keyed by the id of the thing that produced it and
 * kept in an insertion-ordered map, so folding an event twice replaces a line
 * rather than appending a duplicate.
 */
interface Accum {
  lines: Map<string, SubagentLine>;
  subagents: Map<string, SubagentInfo>;
  messageIds: Set<string>;
  toolCallIds: Set<string>;
  /** Growing text/argument buffers, keyed by message or tool-call id. */
  buffers: Map<string, string>;
  toolNames: Map<string, string>;
}

const emptyAccum = (): Accum => ({
  lines: new Map(),
  subagents: new Map(),
  messageIds: new Set(),
  toolCallIds: new Set(),
  buffers: new Map(),
  toolNames: new Map(),
});

const foldEvent = (acc: Accum, event: unknown): Accum => {
  const e = event as Record<string, unknown>;
  const type = str(e.type);
  const tag = str(e.subagentRunId);

  // A run with subagent emission OFF carries no tag anywhere. Ignoring untagged
  // events is what keeps the PARENT agent's own narration out of the console —
  // that belongs in the conversation.
  if (!tag && type !== "SUBAGENT_STARTED") return acc;

  switch (type) {
    case "SUBAGENT_STARTED": {
      const parent = e.parentSubagentRunId
        ? str(e.parentSubagentRunId)
        : undefined;
      acc.subagents.set(tag, {
        subagentRunId: tag,
        name: str(e.name) || "subagent",
        status: "running",
        ...(parent ? { parentSubagentRunId: parent } : {}),
      });
      acc.lines.set(`${tag}-started`, {
        key: `${tag}-started`,
        kind: "started",
        subagentRunId: tag,
        name: str(e.name) || "subagent",
        depth: parent ? 1 : 0,
        text: str(e.name) || "subagent",
      });
      return acc;
    }
    case "SUBAGENT_FINISHED":
    case "SUBAGENT_ERROR": {
      const cur = acc.subagents.get(tag);
      if (cur)
        acc.subagents.set(tag, {
          ...cur,
          status: type === "SUBAGENT_ERROR" ? "error" : "finished",
        });
      return acc;
    }
    case "TEXT_MESSAGE_START": {
      const id = str(e.messageId);
      if (id) {
        // The join that lets the chat suppress this message inline.
        acc.messageIds.add(id);
        acc.buffers.set(id, "");
      }
      return acc;
    }
    case "TEXT_MESSAGE_CONTENT": {
      const id = str(e.messageId);
      const delta = str(e.delta);
      if (!id || !delta) return acc;
      const grown = (acc.buffers.get(id) ?? "") + delta;
      acc.buffers.set(id, grown);
      acc.lines.set(`${id}-text`, {
        key: `${id}-text`,
        kind: "text",
        subagentRunId: tag,
        depth: 1,
        text: grown,
      });
      return acc;
    }
    case "TOOL_CALL_START": {
      const id = str(e.toolCallId);
      const name = str(e.toolCallName);
      if (!id || !name) return acc;
      acc.toolCallIds.add(id);
      acc.toolNames.set(id, name);
      acc.buffers.set(`args:${id}`, "");
      acc.lines.set(`${id}-cmd`, {
        key: `${id}-cmd`,
        kind: "tool",
        subagentRunId: tag,
        depth: 1,
        toolName: name,
        text: toolLine(name, "{}"),
      });
      return acc;
    }
    case "TOOL_CALL_ARGS": {
      const id = str(e.toolCallId);
      if (!id) return acc;
      const grown = (acc.buffers.get(`args:${id}`) ?? "") + str(e.delta);
      acc.buffers.set(`args:${id}`, grown);
      const name = acc.toolNames.get(id) ?? "";
      const prev = acc.lines.get(`${id}-cmd`);
      // Re-render the command as its arguments stream, so a long heredoc appears
      // progressively instead of as a bare tool name.
      if (prev)
        acc.lines.set(prev.key, { ...prev, text: toolLine(name, grown) });
      return acc;
    }
    case "TOOL_CALL_RESULT": {
      const id = str(e.toolCallId);
      if (!id) return acc;
      const { text, failed } = resultLine(str(e.content));
      if (!text) return acc;
      acc.lines.set(`${id}-out`, {
        key: `${id}-out`,
        kind: "result",
        subagentRunId: tag,
        depth: 2,
        text,
        failed,
      });
      return acc;
    }
    default:
      return acc;
  }
};

/** The accumulated view, derived from the mutable accumulator. */
type Snapshot = Omit<SubagentActivity, "isRunning">;

const EMPTY_SNAPSHOT: Snapshot = {
  lines: [],
  subagentMessageIds: new Set(),
  subagentToolCallIds: new Set(),
  subagents: new Map(),
};

const derive = (acc: Accum): Snapshot => ({
  lines: Array.from(acc.lines.values()).map((l) =>
    l.name ? l : { ...l, name: acc.subagents.get(l.subagentRunId)?.name },
  ),
  subagentMessageIds: new Set(acc.messageIds),
  subagentToolCallIds: new Set(acc.toolCallIds),
  subagents: new Map(acc.subagents),
});

/** Coalesce a burst of events into one render. */
const PUBLISH_MS = 100;

export const SubagentActivityProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { agent } = useAgent({
    // Run status only. Everything else arrives through `onEvent`, and
    // subscribing to message notifications would re-render this subtree on a
    // signal it does not read.
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const threadId = useCopilotChatConfiguration()?.threadId;

  /**
   * The accumulator is MUTABLE and lives in a ref; the rendered value lives in
   * state.
   *
   * The split is not incidental. Folding 3000 events by copying an immutable
   * accumulator each time is wasteful, but reading a ref during render is a
   * genuine correctness bug (React's `react-hooks/refs` rule rejects it — under
   * concurrent rendering the read can come from a paint that never commits). So
   * the ref is only ever touched inside effects, and what render sees is a
   * derived snapshot published to state.
   */
  const accRef = useRef<Accum>(emptyAccum());
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);

  // Coalesced publish: events arrive in bursts of hundreds, and one render per
  // event would make the console the most expensive thing on the page.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publish = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setSnapshot(derive(accRef.current));
    }, PUBLISH_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // NOTE: there is no "reset on thread change" effect here on purpose. One
  // accumulator per conversation is achieved by REMOUNTING — the mount site
  // passes `key={threadId}` — which is React's own answer to resetting state
  // when an input changes, and avoids a `setState` inside an effect (which
  // `pnpm lint` rejects, correctly: it schedules a second render pass for
  // something the component could have been born with).

  /**
   * SEED from the thread's persisted events.
   *
   * `agent.subscribe` only ever sees a LIVE run, so reopening a thread would
   * otherwise show an empty console and let the subagent's narration back into
   * the conversation — the run's whole journey missing from a thread that
   * plainly did the work.
   *
   * The persisted EVENTS carry the attribution the persisted MESSAGES do not:
   * measured on one run, 2888 of 3026 events tagged versus 0 of 53 messages.
   * When the runtime carries `subagentRunId` through to the message shape this
   * seed becomes unnecessary.
   */
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/copilotkit/threads/${encodeURIComponent(threadId)}/events`,
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { events?: unknown[] };
        if (cancelled || !body.events?.length) return;
        for (const ev of body.events) foldEvent(accRef.current, ev);
        setSnapshot(derive(accRef.current));
      } catch {
        // A thread with no stored events (or a runtime without the route) is a
        // normal state, not an error: the console starts empty and fills from
        // the live stream. Failing loudly would put an error in front of a user
        // whose run is about to work fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Live events fold into the same accumulator. Overlap with the seed is safe:
  // `foldEvent` keys every line by the id of the thing that produced it, so
  // folding an event twice replaces a line rather than appending a duplicate.
  useEffect(() => {
    if (!agent) return;
    const sub = agent.subscribe({
      onEvent: ({ event }) => {
        foldEvent(accRef.current, event);
        publish();
      },
    });
    return () => sub.unsubscribe();
  }, [agent, publish]);

  const isRunning = agent?.isRunning ?? false;
  const value = useMemo<SubagentActivity>(
    () => ({ ...snapshot, isRunning }),
    [snapshot, isRunning],
  );

  return (
    <SubagentActivityContext.Provider value={value}>
      {children}
    </SubagentActivityContext.Provider>
  );
};
