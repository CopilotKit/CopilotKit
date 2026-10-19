import type { Message } from "@ag-ui/client";

import type { Subagent } from "./subagent-state";

/**
 * @internal One subagent's messages, grouped for rendering. `subagent` is
 * undefined when the producer attributed messages without announcing them.
 */
export interface ɵSubagentGroup {
  subagentRunId: string;
  subagent: Subagent | undefined;
  messages: Message[];
}

/**
 * @internal Where each group renders. Application authors must not depend on
 * this shape.
 */
export interface ɵSubagentLayout {
  /** Messages with no `subagentRunId`, in their original order. */
  topLevel: Message[];
  /** Groups to render right after the tool call that started them. */
  byToolCallId: Map<string, ɵSubagentGroup[]>;
  /** Groups nested in a parent group that holds no matching tool call. */
  bySubagentRunId: Map<string, ɵSubagentGroup[]>;
  /**
   * Groups with no usable anchor, keyed by the top-level message they follow.
   * `null` means before the first top-level message.
   */
  afterMessageId: Map<string | null, ɵSubagentGroup[]>;
}

/** Top level, a group id, or a tool call's owner. */
type Container = string | null;

function append<K>(
  map: Map<K, ɵSubagentGroup[]>,
  key: K,
  group: ɵSubagentGroup,
) {
  const groups = map.get(key);
  if (groups) groups.push(group);
  else map.set(key, [group]);
}

/**
 * @internal Split a thread's messages into top-level messages and subagent
 * groups, and anchor each group: under the tool call that started it, else
 * inside its parent group, else where its first message was.
 *
 * Anchors that would nest a group inside itself (directly or through other
 * groups) fall back to the top level, so every group renders exactly once.
 */
export function ɵbuildSubagentLayout(
  messages: readonly Message[],
  subagents: readonly Subagent[],
) {
  const subagentById = new Map(
    subagents.map((subagent) => [subagent.subagentRunId, subagent]),
  );
  const topLevel: Message[] = [];
  const groups = new Map<string, ɵSubagentGroup>();
  const followsMessageId = new Map<string, string | null>();
  // Which container holds each tool call: the group that sent it, or the top level.
  const toolCallOwner = new Map<string, Container>();

  for (const message of messages) {
    const owner = message.subagentRunId ?? null;
    if (message.role === "assistant") {
      const toolCalls = message.toolCalls ?? [];
      for (const toolCall of toolCalls) toolCallOwner.set(toolCall.id, owner);
    }
    if (owner === null) {
      topLevel.push(message);
      continue;
    }
    let group = groups.get(owner);
    if (!group) {
      group = {
        subagentRunId: owner,
        subagent: subagentById.get(owner),
        messages: [],
      };
      groups.set(owner, group);
      followsMessageId.set(owner, topLevel.at(-1)?.id ?? null);
    }
    group.messages.push(message);
  }

  // A running subagent that has not sent anything yet still shows its group.
  const lastTopLevelId = topLevel.at(-1)?.id ?? null;
  for (const subagent of subagents) {
    if (groups.has(subagent.subagentRunId)) continue;
    groups.set(subagent.subagentRunId, {
      subagentRunId: subagent.subagentRunId,
      subagent,
      messages: [],
    });
    followsMessageId.set(subagent.subagentRunId, lastTopLevelId);
  }

  type Anchor =
    | { kind: "toolCall"; toolCallId: string; container: Container }
    | { kind: "subagent"; subagentRunId: string; container: Container }
    | { kind: "message"; container: null };

  const anchorOf = (group: ɵSubagentGroup): Anchor => {
    const parentToolCallId = group.subagent?.parentToolCallId;
    const parentSubagentRunId = group.subagent?.parentSubagentRunId;
    if (parentToolCallId !== undefined && toolCallOwner.has(parentToolCallId)) {
      return {
        kind: "toolCall",
        toolCallId: parentToolCallId,
        container: toolCallOwner.get(parentToolCallId) ?? null,
      };
    }
    if (parentSubagentRunId !== undefined && groups.has(parentSubagentRunId)) {
      return {
        kind: "subagent",
        subagentRunId: parentSubagentRunId,
        container: parentSubagentRunId,
      };
    }
    return { kind: "message", container: null };
  };

  const anchors = new Map<string, Anchor>();
  for (const group of groups.values())
    anchors.set(group.subagentRunId, anchorOf(group));

  // Walk each group's container chain; a chain that returns to a group it
  // already passed is a cycle, and this group leaves it for the top level.
  for (const subagentRunId of anchors.keys()) {
    const seen = new Set([subagentRunId]);
    let container = anchors.get(subagentRunId)?.container ?? null;
    while (container !== null) {
      if (seen.has(container)) {
        anchors.set(subagentRunId, { kind: "message", container: null });
        break;
      }
      seen.add(container);
      container = anchors.get(container)?.container ?? null;
    }
  }

  const layout: ɵSubagentLayout = {
    topLevel,
    byToolCallId: new Map(),
    bySubagentRunId: new Map(),
    afterMessageId: new Map(),
  };
  for (const group of groups.values()) {
    const anchor = anchors.get(group.subagentRunId) ?? anchorOf(group);
    switch (anchor.kind) {
      case "toolCall":
        append(layout.byToolCallId, anchor.toolCallId, group);
        break;
      case "subagent":
        append(layout.bySubagentRunId, anchor.subagentRunId, group);
        break;
      case "message":
        append(
          layout.afterMessageId,
          followsMessageId.get(group.subagentRunId) ?? null,
          group,
        );
        break;
    }
  }
  return layout;
}
