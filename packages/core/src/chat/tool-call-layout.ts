import type { Message, ToolCall, ToolMessage } from "@ag-ui/core";
import { partialJSONParse } from "@copilotkit/shared";

/**
 * How the chat shows tool calls.
 *
 * - `"grouped"` (default): calls made in a row share one card, collapsed to a
 *   summary ("Used 3 tools") that opens to a row per call.
 * - `"line"`: the same grouping as a quiet line of text, like the reasoning
 *   message's "Thought for 4 seconds".
 * - `"stacked"`: the latest call on top of a stack of the earlier ones; click
 *   to fan the stack out into its cards.
 * - `"turn"`: the agent works in the open (narration, then a row per call),
 *   and when the reply is done everything before it folds into "Worked for 9s".
 * - `"separate"`: every call gets its own card.
 *
 * Only calls drawn by a renderer that opts into grouping (`group: true`) are
 * grouped. CopilotKit's built-in tool card does. Any other call always shows
 * on its own and splits the group around it.
 */
export type CopilotChatToolCallDisplay =
  | "grouped"
  | "line"
  | "stacked"
  | "turn"
  | "separate";

/** One tool call and, once it has finished, the message carrying its result. */
export interface ToolCallEntry {
  toolCall: ToolCall;
  toolMessage?: ToolMessage;
}

export type ToolCallSegment =
  /** Consecutive calls drawn by renderers that opted into grouping. */
  | {
      kind: "group";
      id: string;
      calls: ToolCallEntry[];
      /** Nothing renders after this group yet, so a running agent may add to it. */
      trailing: boolean;
    }
  /**
   * A call drawn by a renderer that didn't opt into grouping, or with no
   * renderer at all. The latter renders nothing (and warns in development)
   * without breaking a group.
   */
  | { kind: "call"; id: string; call: ToolCallEntry; rendered: boolean };

/** What one assistant message's tool-call area renders. */
export interface ToolCallLayout {
  segments: ToolCallSegment[];
  /** Changes whenever anything this layout renders changes. Use it to memoize. */
  signature: string;
}

/** Which tool-call renderers are registered. */
export interface ToolCallRendererNames {
  /** Tool names with a renderer of their own. */
  named: ReadonlySet<string>;
  /** Of those, the ones whose renderer opted into grouping. */
  groupedNames: ReadonlySet<string>;
  /** A wildcard (`"*"`) renderer is registered. */
  wildcard: boolean;
  /** The wildcard renderer opted into grouping (the built-in card does). */
  wildcardGroups: boolean;
}

/**
 * The tool-call display state a message view hands down to each message's
 * tool-call area, so every layer follows the view's `toolCallDisplay`.
 */
export interface ToolCallDisplayContextValue {
  display: CopilotChatToolCallDisplay;
  isRunning: boolean;
  /** Each assistant message's tool calls, laid out across the whole list. */
  layouts: ReadonlyMap<string, ToolCallLayout>;
  /**
   * `"turn"` display: for each message in a reply's working phase, whether
   * that work is showing. Messages not in here are the reply itself.
   */
  workOpen: ReadonlyMap<string, boolean>;
  /**
   * Like `workOpen`, for the messages' text: text that ends the reply stays
   * out of it even when its message also calls a tool.
   */
  workTextOpen: ReadonlyMap<string, boolean>;
}

function contentLength(content: ToolMessage["content"]) {
  return typeof content === "string"
    ? content.length
    : JSON.stringify(content ?? "").length;
}

const entrySignature = ({ toolCall, toolMessage }: ToolCallEntry) =>
  [
    toolCall.id,
    toolCall.function.name,
    toolCall.function.arguments.length,
    toolMessage
      ? `${contentLength(toolMessage.content)}${toolMessage.error ? "!" : ""}`
      : "-",
  ].join(":");

function signatureOf(segments: readonly ToolCallSegment[]) {
  return segments
    .map((segment) =>
      segment.kind === "call"
        ? `c(${entrySignature(segment.call)})`
        : `g${segment.trailing ? "*" : ""}(${segment.calls.map(entrySignature).join(",")})`,
    )
    .join("|");
}

/**
 * Indexes tool results by the id of the call they answer.
 *
 * @param messages - The messages to search. Only `role: "tool"` messages count.
 */
export function getToolResults(messages: readonly Message[]) {
  const results = new Map<string, ToolMessage>();
  for (const message of messages) {
    if (message.role === "tool") results.set(message.toolCallId, message);
  }
  return results;
}

/**
 * Lays out the tool calls of every assistant message in `rendered`.
 *
 * Calls drawn by a renderer that opted into grouping join the group that is
 * open. Anything else that shows between them closes it: assistant text, a
 * user, reasoning or activity message, or a call drawn by any other renderer.
 * A group belongs to the message where it starts, so later messages whose
 * calls joined it render no tool calls themselves.
 *
 * @param rendered - The messages as the chat renders them, in order.
 * @param all - Every message, for finding tool results (a transform may hide them).
 * @param renderers - The registered renderers, from `getToolCallRendererNames`.
 * @returns A map from assistant message id to its layout.
 *
 * @example
 * ```ts
 * const names = getToolCallRendererNames(core.renderToolCalls);
 * const layouts = getToolCallLayouts(renderedMessages, messages, names);
 * layouts.get(message.id)?.segments;
 * ```
 */
export function getToolCallLayouts(
  rendered: readonly Message[],
  all: readonly Message[],
  renderers: ToolCallRendererNames,
) {
  const results = getToolResults(all);
  const layouts = new Map<string, ToolCallSegment[]>();
  let open: Extract<ToolCallSegment, { kind: "group" }> | undefined;

  for (const message of rendered) {
    if (message.role === "tool") continue;
    if (message.role !== "assistant") {
      open = undefined;
      continue;
    }
    const hasText =
      typeof message.content === "string" && message.content.trim() !== "";
    if (hasText) open = undefined;

    const segments: ToolCallSegment[] = [];
    layouts.set(message.id, segments);
    // Streaming can repeat a call: keep its first position, last content.
    const toolCalls = new Map<string, ToolCall>();
    const messageToolCalls = message.toolCalls ?? [];
    for (const toolCall of messageToolCalls) {
      toolCalls.set(toolCall.id, toolCall);
    }
    const uniqueToolCalls = toolCalls.values();
    for (const toolCall of uniqueToolCalls) {
      const entry = { toolCall, toolMessage: results.get(toolCall.id) };

      const name = toolCall.function.name;
      const named = renderers.named.has(name);
      const isRendered = named || renderers.wildcard;
      const groups = named
        ? renderers.groupedNames.has(name)
        : renderers.wildcardGroups;

      if (!isRendered || !groups) {
        if (isRendered) open = undefined;
        segments.push({
          kind: "call",
          id: toolCall.id,
          call: entry,
          rendered: isRendered,
        });
      } else if (open) {
        open.calls.push(entry);
      } else {
        open = {
          kind: "group",
          id: toolCall.id,
          calls: [entry],
          trailing: false,
        };
        segments.push(open);
      }
    }
  }
  if (open) open.trailing = true;

  const layout = new Map<string, ToolCallLayout>();
  for (const [id, segments] of layouts) {
    layout.set(id, { segments, signature: signatureOf(segments) });
  }
  return layout;
}

const TOOL_CALL_SLOT_PREFIX = "tool-call-";
const WILDCARD_TOOL_CALL_SLOT = "tool-call";

/** Options for `getToolCallRendererNames`. */
export interface ToolCallRendererNamesOptions {
  /**
   * The names of the tool-call slots a view was given (Vue). A slot wins over
   * a registered renderer and never groups, because the chat cannot tell what
   * it draws. `tool-call-<name>` takes that tool. `tool-call` takes every
   * tool and turns grouping off.
   */
  slotNames?: readonly string[];
  /**
   * More tool names that have a renderer of their own, which never group
   * (Angular: client tool renderers with a component, and human-in-the-loop
   * tools).
   */
  extraNamed?: readonly string[];
  /**
   * A built-in wildcard card that draws tools no other renderer takes
   * (Angular: `defaultToolRendering`). A registered `"*"` renderer wins over
   * it, including its `group` choice.
   */
  builtInWildcard?: { enabled: boolean; groups: boolean };
}

/**
 * Works out which tool calls have a renderer and which of those group, for
 * `getToolCallLayouts`.
 *
 * @param renderers - The registered renderers. A renderer named `"*"` is the
 *   wildcard. `group: true` opts the renderer into grouping.
 * @param options - Slots, extra named tools, and a built-in wildcard card.
 *   See `ToolCallRendererNamesOptions`.
 *
 * @example
 * ```ts
 * // React: only registered renderers.
 * getToolCallRendererNames(core.renderToolCalls);
 * // Vue: the view's slots count too.
 * getToolCallRendererNames(core.renderToolCalls, { slotNames: Object.keys(slots) });
 * // Angular: client and human-in-the-loop renderers, and the built-in card.
 * getToolCallRendererNames(appRenderers, {
 *   extraNamed: [...clientNames, ...hitlNames],
 *   builtInWildcard: { enabled: defaultToolRenderingEnabled, groups: true },
 * });
 * ```
 */
export function getToolCallRendererNames(
  renderers: ReadonlyArray<{ name: string; group?: boolean }>,
  options: ToolCallRendererNamesOptions = {},
) {
  const { slotNames = [], extraNamed = [], builtInWildcard } = options;
  const hasWildcardSlot = slotNames.includes(WILDCARD_TOOL_CALL_SLOT);
  const slotTools = slotNames
    .filter((name) => name.startsWith(TOOL_CALL_SLOT_PREFIX))
    .map((name) => name.slice(TOOL_CALL_SLOT_PREFIX.length));
  const named = renderers.filter((renderer) => renderer.name !== "*");
  const wildcards = renderers.filter((renderer) => renderer.name === "*");
  const hasAppWildcard = wildcards.length > 0;
  const isBuiltInEnabled = builtInWildcard?.enabled ?? false;
  const builtInGroups = isBuiltInEnabled && (builtInWildcard?.groups ?? false);

  const groupedNames = hasWildcardSlot
    ? []
    : named
        .filter(
          (renderer) => renderer.group && !slotTools.includes(renderer.name),
        )
        .map((renderer) => renderer.name);
  const appWildcardGroups = wildcards.some((renderer) => renderer.group);

  const names: ToolCallRendererNames = {
    named: new Set([
      ...named.map((renderer) => renderer.name),
      ...slotTools,
      ...extraNamed,
    ]),
    groupedNames: new Set(groupedNames),
    wildcard: hasAppWildcard || hasWildcardSlot || isBuiltInEnabled,
    wildcardGroups:
      !hasWildcardSlot && (hasAppWildcard ? appWildcardGroups : builtInGroups),
  };
  return names;
}

/** A reply's working phase, for the `"turn"` display. */
export interface TurnWork {
  /** Stable across the turn's life: the id of the user message it answers. */
  key: string;
  /** The first assistant-side message, where the "Worked for" line goes. */
  firstMessageId: string;
  /** Everything up to and including the last message with a tool call. */
  workMessageIds: ReadonlySet<string>;
  /**
   * The reply's last assistant message, when it has text and is part of the
   * work (it also calls a tool). Its text is the answer, so it stays out.
   */
  replyTextMessageId?: string;
  calls: ToolCallEntry[];
  /** No user message follows, so the agent may still be working on it. */
  isLatest: boolean;
}

/** The turn key of a reply that no user message starts. */
const FIRST_TURN_KEY = "start";

/**
 * Finds the working phase of every reply in `rendered`: its messages up to the
 * last one that calls a tool. Text in there was narration. What follows is the
 * reply itself. Replies that called no tools are left out, except the latest,
 * which may be about to.
 *
 * @param rendered - The messages as the chat renders them, in order.
 * @param layouts - The layouts from `getToolCallLayouts` for the same messages.
 * @returns A map from turn key (see `TurnWork.key`) to the turn's work.
 */
export function getTurnWork(
  rendered: readonly Message[],
  layouts: ReadonlyMap<string, ToolCallLayout>,
) {
  const turns = new Map<string, TurnWork>();
  let start = 0;
  while (start < rendered.length) {
    let end = start;
    while (end < rendered.length && rendered[end]!.role !== "user") end++;
    const key = start > 0 ? rendered[start - 1]!.id : FIRST_TURN_KEY;
    const visible = rendered
      .slice(start, end)
      .filter((message) => message.role !== "tool");
    const isLatest = end === rendered.length;

    // A message's calls may sit in a group an earlier message owns, so
    // collect every shown call first, then find the last message making one.
    const calls: ToolCallEntry[] = [];
    for (const message of visible) {
      const segments = layouts.get(message.id)?.segments ?? [];
      for (const segment of segments) {
        if (segment.kind === "group") calls.push(...segment.calls);
        else if (segment.rendered) calls.push(segment.call);
      }
    }
    const shown = new Set(calls.map((entry) => entry.toolCall.id));
    let lastWork = -1;
    visible.forEach((message, index) => {
      const makesShownCall =
        message.role === "assistant" &&
        message.toolCalls?.some((call) => shown.has(call.id));
      if (makesShownCall) lastWork = index;
    });

    const first = visible[0];
    if (first && (calls.length > 0 || isLatest)) {
      let lastAssistant = -1;
      visible.forEach((message, index) => {
        if (message.role === "assistant") lastAssistant = index;
      });
      const replyText = visible[lastAssistant]?.content;
      const endsWithWork =
        lastAssistant >= 0 &&
        lastAssistant <= lastWork &&
        typeof replyText === "string" &&
        replyText.trim().length > 0;

      turns.set(key, {
        key,
        firstMessageId: first.id,
        workMessageIds: new Set(
          visible.slice(0, lastWork + 1).map((message) => message.id),
        ),
        replyTextMessageId: endsWithWork
          ? visible[lastAssistant]!.id
          : undefined,
        calls,
        isLatest,
      });
    }
    start = end + 1;
  }
  return turns;
}

/**
 * The key of the latest reply (see `TurnWork.key`): the id of the last user
 * message, or `"start"` when there is none.
 *
 * @param rendered - The messages as the chat renders them, in order.
 */
export function getLatestTurnKey(rendered: readonly Message[]) {
  for (let i = rendered.length - 1; i >= 0; i--) {
    const message = rendered[i]!;
    if (message.role === "user") return message.id;
  }
  return FIRST_TURN_KEY;
}

/** What decides whether a `"turn"` reply's work shows. */
export interface TurnOpenState {
  /** Turns the user opened (`true`) or closed (`false`) by hand. */
  toggledTurns: ReadonlyMap<string, boolean>;
  isRunning: boolean;
  /** From `getLatestTurnKey`. */
  latestTurnKey: string;
}

/**
 * Whether the agent is working on this reply now: it is the latest one and a
 * run is going.
 *
 * @param turnKey - The reply's `TurnWork.key`.
 * @param state - The run state and the latest turn key.
 */
export function isTurnWorking(
  turnKey: string,
  state: Pick<TurnOpenState, "isRunning" | "latestTurnKey">,
) {
  return state.isRunning && turnKey === state.latestTurnKey;
}

/**
 * Whether a reply's work shows. It shows while the agent works on the reply
 * and folds once the reply is done, unless the user opened or closed it.
 *
 * @param turnKey - The reply's `TurnWork.key`.
 * @param state - The user's toggles, the run state, and the latest turn key.
 */
export function isTurnWorkOpen(turnKey: string, state: TurnOpenState) {
  return state.toggledTurns.get(turnKey) ?? isTurnWorking(turnKey, state);
}

/**
 * For each message in a reply's working phase, whether its work and its text
 * show. Text that ends the reply stays out of `workTextOpen` even when its
 * message also calls a tool, because it is the answer.
 *
 * @param turns - The turns from `getTurnWork`.
 * @param state - The user's toggles, the run state, and the latest turn key.
 * @returns The `workOpen` and `workTextOpen` maps of `ToolCallDisplayContextValue`.
 */
export function getWorkOpenState(
  turns: Iterable<TurnWork>,
  state: TurnOpenState,
) {
  const workOpen = new Map<string, boolean>();
  const workTextOpen = new Map<string, boolean>();
  for (const turn of turns) {
    const turnOpen = isTurnWorkOpen(turn.key, state);
    for (const id of turn.workMessageIds) {
      workOpen.set(id, turnOpen);
      if (id !== turn.replyTextMessageId) workTextOpen.set(id, turnOpen);
    }
  }
  return { workOpen, workTextOpen };
}

/** How long the agent has worked on one reply, summed over its runs. */
export interface WorkTime {
  elapsedMs: number;
  /** When the current run started (epoch ms), while the agent works. */
  workingSince?: number;
}

/**
 * Records run starts and ends in `workTimes`, for "Worked for 9s". Time spent
 * between runs (say, waiting for an approval) does not count. A reply is only
 * timed when this client saw it start from the user's message, so a restored
 * thread gets no entry. Calling it again with the same state changes nothing.
 *
 * @param workTimes - The times by turn key. This function updates it in place.
 * @param state - The run state now.
 * @param state.lastMessageRole - The role of the last rendered message.
 * @param state.now - The current time, in epoch ms.
 */
export function recordWorkTime(
  workTimes: Map<string, WorkTime>,
  state: {
    isRunning: boolean;
    latestTurnKey: string;
    lastMessageRole: Message["role"] | undefined;
    now: number;
  },
) {
  const { isRunning, latestTurnKey, lastMessageRole, now } = state;
  if (isRunning) {
    const times = workTimes.get(latestTurnKey);
    if (times) times.workingSince ??= now;
    else if (lastMessageRole === "user")
      workTimes.set(latestTurnKey, { elapsedMs: 0, workingSince: now });
    return;
  }
  const allTimes = workTimes.values();
  for (const times of allTimes) {
    if (times.workingSince === undefined) continue;
    times.elapsedMs += now - times.workingSince;
    times.workingSince = undefined;
  }
}

/**
 * The status of one row in a tool-call group. A call that never got a result
 * after the run ended (Stop, an error) is `"stopped"`.
 */
export type ToolCallRowStatus = "running" | "done" | "failed" | "stopped";

/**
 * The status of one call in a group. A call without a result is running only
 * while the group is active: once the run has moved on or ended, its result
 * is never coming.
 *
 * @param entry - The call and its result, if any.
 * @param active - The agent may still finish the group's calls.
 */
export function getToolCallRowStatus(entry: ToolCallEntry, active: boolean) {
  const { toolMessage } = entry;
  let status: ToolCallRowStatus;
  if (toolMessage) status = toolMessage.error ? "failed" : "done";
  else status = active ? "running" : "stopped";
  return status;
}

/**
 * The first non-empty string argument, with runs of whitespace collapsed to
 * one space. This is usually a command, path or query.
 *
 * @param parameters - The call's parsed arguments.
 * @returns The preview, or `undefined` when no argument is a non-empty string.
 */
export function getArgumentPreview(parameters: unknown) {
  if (!parameters || typeof parameters !== "object") return undefined;
  const value = Object.values(parameters).find(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return value?.replace(/\s+/g, " ");
}

/**
 * `getArgumentPreview` for a call whose arguments may still be streaming in
 * as partial JSON.
 *
 * @param entry - The call.
 */
export function getToolCallPreview(entry: ToolCallEntry) {
  return getArgumentPreview(
    partialJSONParse(entry.toolCall.function.arguments),
  );
}

/**
 * The names of the tools the calls used, in first-use order, with a count
 * for repeats: `"run_command ×2, read_file"`.
 *
 * @param calls - The calls to name.
 */
export function formatToolNames(calls: readonly ToolCallEntry[]) {
  const counts = new Map<string, number>();
  for (const { toolCall } of calls) {
    const name = toolCall.function.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");
}

/**
 * How many of the calls finished with an error.
 *
 * @param calls - The calls to count.
 */
export function countFailedToolCalls(calls: readonly ToolCallEntry[]) {
  return calls.filter((call) => call.toolMessage?.error).length;
}

/**
 * A count followed by the word that fits it: `"1 tool"`, `"3 tools"`.
 *
 * @param count - The number to show.
 * @param words - The word for exactly one (`one`) and for any other count (`other`).
 *
 * @example
 * ```ts
 * pluralize(3, { one: "tool", other: "tools" }); // "3 tools"
 * ```
 */
export function pluralize(
  count: number,
  words: { one: string; other: string },
) {
  return `${count} ${count === 1 ? words.one : words.other}`;
}

/**
 * A tool call's arguments or result as display text. Strings pass through.
 * Other values are pretty-printed JSON. A value JSON cannot encode (say, a
 * circular reference) falls back to `String(value)`, then to
 * `"[unserializable]"`, so it never throws during a render.
 *
 * @param value - The arguments or the result.
 */
export function stringifyToolCallPayload(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    console.warn(
      "[CopilotKit] Failed to JSON.stringify tool-call payload; falling back to String():",
      err,
    );
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/**
 * How long a `"turn"` reply worked, as short text: `"45s"`, `"1m 5s"`, `"2m"`.
 * Used for the live timer and the final duration. Partial seconds round down,
 * and a negative time reads `"0s"`.
 *
 * @param ms - The time in milliseconds.
 */
export function formatWorkDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * How long a model reasoned, split into the parts a label needs. The default
 * English text for each unit:
 *
 * - `fewSeconds`: `"a few seconds"`.
 * - `seconds`: `"${seconds} seconds"`.
 * - `minutes`: `"1 minute"`, or `"${minutes} minutes"` when more than one.
 * - `minutesSeconds`: `"${minutes}m ${seconds}s"`.
 */
export type ReasoningDuration =
  | { unit: "fewSeconds" }
  | { unit: "seconds"; seconds: number }
  | { unit: "minutes"; minutes: number }
  | { unit: "minutesSeconds"; minutes: number; seconds: number };

/**
 * Splits a reasoning time into the unit and counts the "Thought for ..."
 * header shows. See `ReasoningDuration` for the text each unit maps to.
 *
 * - Under 1 second: `fewSeconds`.
 * - Under 60 seconds: `seconds`, rounded to the nearest second.
 * - Whole minutes after rounding the seconds: `minutes`.
 * - Otherwise: `minutesSeconds`.
 *
 * @param seconds - The elapsed time in seconds. It may have a fraction.
 */
export function formatReasoningDuration(seconds: number) {
  if (seconds < 1) return { unit: "fewSeconds" } satisfies ReasoningDuration;
  if (seconds < 60) {
    return {
      unit: "seconds",
      seconds: Math.round(seconds),
    } satisfies ReasoningDuration;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (rest === 0)
    return { unit: "minutes", minutes } satisfies ReasoningDuration;
  return {
    unit: "minutesSeconds",
    minutes,
    seconds: rest,
  } satisfies ReasoningDuration;
}
