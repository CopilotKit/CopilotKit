import { humanizeEventType } from "./event-adapter.js";
import type { ApiAgentEvent } from "./event-adapter.js";
import type { ConversationItem, ConversationUser } from "./message-adapter.js";

export type TimelineItemKind =
  | "message"
  | "tool"
  | "state"
  | "run"
  | "event"
  | "warning";

export type TimelineItem = {
  id: string;
  messageId?: string;
  kind: TimelineItemKind;
  title: string;
  body?: string;
  timestamp: string | number;
  sourceIndex: number;
  severity?: "warning" | "error";
  details?: Record<string, unknown>;
};

export type TimelineAgentMessage = Readonly<{
  id?: string;
  role: string;
  contentText: string;
}>;

function messageTitle(role: string): string {
  const normalized = role.trim() || "message";
  const label = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}`;
  return `${label} message`;
}

function timelineItemsFromEvents(events: ApiAgentEvent[]): TimelineItem[] {
  if (events.length === 0) return [];

  const items: TimelineItem[] = [];
  const messageItems = new Map<string, TimelineItem>();
  const toolItems = new Map<string, TimelineItem & { rawArgs?: string }>();

  const readString = (
    payload: Record<string, unknown>,
    keys: string[],
  ): string | null => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string") return value;
    }
    return null;
  };

  const sourceIndexFor = (event: ApiAgentEvent): number =>
    event.sourceIndex ?? 0;

  const appendWarning = (
    event: ApiAgentEvent,
    title: string,
    body: string,
    severity: "warning" | "error" = "warning",
  ): void => {
    const sourceIndex = sourceIndexFor(event);
    items.push({
      id: `warning-${sourceIndex}-${items.length}`,
      kind: "warning",
      title,
      body,
      timestamp: event.timestamp,
      sourceIndex,
      severity,
    });
  };

  const ensureMessage = (event: ApiAgentEvent, role: string): TimelineItem => {
    const sourceIndex = sourceIndexFor(event);
    const key =
      readString(event.payload, ["messageId", "message_id", "id"]) ??
      `message-${sourceIndex}`;
    let item = messageItems.get(key);
    if (!item) {
      item = {
        id: `message-${key}`,
        messageId: key,
        kind: "message",
        title: messageTitle(role || "message"),
        body: "",
        timestamp: event.timestamp,
        sourceIndex,
      };
      messageItems.set(key, item);
      items.push(item);
    }
    return item;
  };

  const ensureTool = (
    event: ApiAgentEvent,
  ): TimelineItem & {
    rawArgs?: string;
  } => {
    const sourceIndex = sourceIndexFor(event);
    const key =
      readString(event.payload, [
        "toolCallId",
        "tool_call_id",
        "id",
        "callId",
      ]) ?? `tool-${sourceIndex}`;
    let item = toolItems.get(key);
    if (!item) {
      item = {
        id: `tool-${key}`,
        kind: "tool",
        title:
          readString(event.payload, [
            "toolCallName",
            "toolName",
            "name",
            "functionName",
          ]) ?? "Tool call",
        body: "",
        timestamp: event.timestamp,
        sourceIndex,
      };
      toolItems.set(key, item);
      items.push(item);
    }
    return item;
  };

  for (const event of events) {
    const { type, payload } = event;
    const sourceIndex = sourceIndexFor(event);

    if (type === "UNKNOWN") {
      appendWarning(
        event,
        "Unknown AG-UI event",
        "The event is missing a string type and could not be normalized.",
      );
      continue;
    }

    if (type === "RUN_STARTED" || type === "STEP_STARTED") {
      items.push({
        id: `${type}-${sourceIndex}`,
        kind: "run",
        title: type === "RUN_STARTED" ? "Run started" : "Step started",
        timestamp: event.timestamp,
        sourceIndex,
        details: payload,
      });
      continue;
    }

    if (type === "RUN_FINISHED" || type === "STEP_FINISHED") {
      items.push({
        id: `${type}-${sourceIndex}`,
        kind: "run",
        title: type === "RUN_FINISHED" ? "Run finished" : "Step finished",
        timestamp: event.timestamp,
        sourceIndex,
        details: payload,
      });
      continue;
    }

    if (type === "RUN_ERROR" || type === "ERROR") {
      items.push({
        id: `${type}-${sourceIndex}`,
        kind: "warning",
        title: "Run error",
        body: readString(payload, ["message", "error", "description"]) ?? "",
        timestamp: event.timestamp,
        sourceIndex,
        severity: "error",
        details: payload,
      });
      continue;
    }

    if (type === "TEXT_MESSAGE_START") {
      ensureMessage(event, readString(payload, ["role"]) ?? "assistant");
      continue;
    }

    if (type === "TEXT_MESSAGE_CONTENT") {
      const item = ensureMessage(
        event,
        readString(payload, ["role"]) ?? "assistant",
      );
      item.body = `${item.body ?? ""}${
        readString(payload, ["delta", "content", "text"]) ?? ""
      }`;
      continue;
    }

    if (type === "TEXT_MESSAGE_END") {
      ensureMessage(event, readString(payload, ["role"]) ?? "assistant");
      continue;
    }

    if (type === "TOOL_CALL_START") {
      ensureTool(event);
      continue;
    }

    if (type === "TOOL_CALL_ARGS") {
      const item = ensureTool(event);
      const chunk =
        readString(payload, ["args", "arguments", "delta"]) ??
        (typeof payload.args === "object"
          ? JSON.stringify(payload.args)
          : null);
      if (chunk) {
        item.rawArgs = `${item.rawArgs ?? ""}${chunk}`;
        item.body = item.rawArgs;
      }
      continue;
    }

    if (type === "TOOL_CALL_END") {
      const item = ensureTool(event);
      if (item.rawArgs) {
        try {
          JSON.parse(item.rawArgs);
        } catch {
          appendWarning(
            event,
            "Could not decode tool call arguments",
            item.rawArgs,
          );
        }
      }
      continue;
    }

    if (type === "TOOL_CALL_RESULT") {
      const item = ensureTool(event);
      const result = readString(payload, ["result", "content", "delta"]);
      if (result) {
        item.body = item.body
          ? `${item.body}\nResult: ${result}`
          : `Result: ${result}`;
        try {
          JSON.parse(result);
        } catch {
          appendWarning(event, "Could not decode tool result", result);
        }
      }
      continue;
    }

    if (type.startsWith("STATE_")) {
      items.push({
        id: `${type}-${sourceIndex}`,
        kind: "state",
        title: type === "STATE_SNAPSHOT" ? "State snapshot" : "State delta",
        timestamp: event.timestamp,
        sourceIndex,
        details: payload,
      });
      continue;
    }

    items.push({
      id: `event-${sourceIndex}`,
      kind: "event",
      title: humanizeEventType(type),
      timestamp: event.timestamp,
      sourceIndex,
      details: payload,
    });
  }

  return items;
}

function conversationUsers(
  conversation: ConversationItem[],
  agentMessages: ReadonlyArray<TimelineAgentMessage>,
): ConversationUser[] {
  const users: ConversationUser[] = [];
  const seenIds = new Set<string>();
  const seenBodies = new Set<string>();
  const push = (user: ConversationUser) => {
    const body = user.content.trim();
    if (!body) return;
    if (seenIds.has(user.id) || seenBodies.has(body)) return;
    seenIds.add(user.id);
    seenBodies.add(body);
    users.push(user);
  };
  for (const item of conversation) {
    if (item.type === "user") push(item);
  }
  agentMessages.forEach((message, index) => {
    if (message.role !== "user") return;
    push({
      id: message.id ?? `live-user-${index}`,
      type: "user",
      content: message.contentText,
      createdAt: "",
    });
  });
  return users;
}

function mergeUserMessagesIntoTimeline(
  items: TimelineItem[],
  users: ConversationUser[],
): TimelineItem[] {
  if (items.length === 0 || users.length === 0) return items;

  const shownIds = new Set<string>();
  const shownBodies = new Set<string>();
  for (const item of items) {
    if (item.kind !== "message") continue;
    if (!item.title.toLowerCase().startsWith("user")) continue;
    if (item.messageId) shownIds.add(item.messageId);
    const body = item.body?.trim();
    if (body) shownBodies.add(body);
  }

  const missing = users.filter((user) => {
    if (shownIds.has(user.id)) return false;
    if (shownBodies.has(user.content.trim())) return false;
    return true;
  });
  if (missing.length === 0) return items;

  const insertAt: number[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (item.kind === "run" && item.title === "Run started") {
      insertAt.push(index);
    }
  }
  if (insertAt.length === 0) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      if (
        item.kind === "message" &&
        item.title.toLowerCase().includes("assistant")
      ) {
        insertAt.push(index);
      }
    }
  }

  const merged = [...items];
  for (let index = missing.length - 1; index >= 0; index--) {
    const user = missing[index]!;
    const row: TimelineItem = {
      id: `conversation-user-${user.id}`,
      messageId: user.id,
      kind: "message",
      title: "User message",
      body: user.content,
      timestamp: user.createdAt || 0,
      sourceIndex: 0,
    };
    merged.splice(insertAt[index] ?? 0, 0, row);
  }
  return merged;
}

export function createTimelineItems(
  events: ApiAgentEvent[],
  conversation: ConversationItem[],
  agentMessages: ReadonlyArray<TimelineAgentMessage>,
): TimelineItem[] {
  return mergeUserMessagesIntoTimeline(
    timelineItemsFromEvents(events),
    conversationUsers(conversation, agentMessages),
  );
}
