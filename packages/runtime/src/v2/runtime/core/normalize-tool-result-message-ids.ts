import type { BaseEvent, Message } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";

type MessageIdEvent = BaseEvent & {
  messageId?: string;
  messages?: Message[];
};

type ToolResultEvent = MessageIdEvent & {
  toolCallId?: string;
};

type ToolCallEvent = BaseEvent & {
  parentMessageId?: string;
  role?: string;
};

const MESSAGE_CREATING_EVENT_TYPES = new Set<string>([
  EventType.TEXT_MESSAGE_START,
  EventType.REASONING_MESSAGE_START,
  EventType.ACTIVITY_SNAPSHOT,
]);

const TOOL_CALL_START_EVENT_TYPES = new Set<string>([
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_CHUNK,
]);

export function createToolResultMessageIdNormalizer(
  initialMessages: Pick<Message, "id">[] = [],
): (event: BaseEvent) => BaseEvent {
  const usedMessageIds = new Set(
    initialMessages
      .map((message) => message.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const resultMessageIdByToolCallId = new Map<string, string>();
  let activeAssistantMessageId: string | undefined;
  let latestAssistantMessageId: string | undefined;

  const reserveMessageId = (messageId: string | undefined) => {
    if (messageId) {
      usedMessageIds.add(messageId);
    }
  };

  const reserveSnapshotMessageIds = (event: MessageIdEvent) => {
    if (Array.isArray(event.messages)) {
      for (const message of event.messages) {
        reserveMessageId(message.id);
      }
    }
  };

  const createResultMessageId = (toolCallId: string) => {
    const baseId = `${toolCallId}-result`;
    let candidate = baseId;
    let suffix = 2;

    while (usedMessageIds.has(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedMessageIds.add(candidate);
    resultMessageIdByToolCallId.set(toolCallId, candidate);
    return candidate;
  };

  const trackAssistantMessageStart = (
    event: MessageIdEvent & { role?: string },
  ) => {
    if (!event.messageId) {
      return;
    }
    const role = event.role ?? "assistant";
    if (role === "assistant") {
      activeAssistantMessageId = event.messageId;
      latestAssistantMessageId = event.messageId;
    }
  };

  const normalizeToolCallParent = (event: BaseEvent): BaseEvent => {
    if (!TOOL_CALL_START_EVENT_TYPES.has(event.type)) {
      return event;
    }

    const toolCallEvent = event as ToolCallEvent;
    const preferredParentMessageId =
      activeAssistantMessageId ?? latestAssistantMessageId;

    if (
      preferredParentMessageId &&
      toolCallEvent.parentMessageId &&
      toolCallEvent.parentMessageId !== preferredParentMessageId
    ) {
      return {
        ...toolCallEvent,
        parentMessageId: preferredParentMessageId,
      } as BaseEvent;
    }

    return event;
  };

  return (event: BaseEvent): BaseEvent => {
    if (event.type === EventType.MESSAGES_SNAPSHOT) {
      reserveSnapshotMessageIds(event as MessageIdEvent);
      return event;
    }

    if (
      event.type === EventType.TEXT_MESSAGE_START ||
      event.type === EventType.TEXT_MESSAGE_CHUNK
    ) {
      const messageEvent = event as MessageIdEvent & { role?: string };
      reserveMessageId(messageEvent.messageId);
      trackAssistantMessageStart(messageEvent);
      return event;
    }

    if (event.type === EventType.TEXT_MESSAGE_END) {
      const messageId = (event as MessageIdEvent).messageId;
      if (messageId && messageId === activeAssistantMessageId) {
        activeAssistantMessageId = undefined;
      }
      return event;
    }

    const parentNormalizedEvent = normalizeToolCallParent(event);

    if (parentNormalizedEvent.type !== EventType.TOOL_CALL_RESULT) {
      if (MESSAGE_CREATING_EVENT_TYPES.has(parentNormalizedEvent.type)) {
        reserveMessageId((parentNormalizedEvent as MessageIdEvent).messageId);
      }
      return parentNormalizedEvent;
    }

    const toolResultEvent = parentNormalizedEvent as ToolResultEvent;
    const { messageId, toolCallId } = toolResultEvent;

    if (!toolCallId) {
      reserveMessageId(messageId);
      return event;
    }

    const existingResultMessageId = resultMessageIdByToolCallId.get(toolCallId);
    if (existingResultMessageId) {
      if (messageId === existingResultMessageId) {
        return event;
      }
      return {
        ...toolResultEvent,
        messageId: existingResultMessageId,
      } as BaseEvent;
    }

    if (messageId && !usedMessageIds.has(messageId)) {
      usedMessageIds.add(messageId);
      resultMessageIdByToolCallId.set(toolCallId, messageId);
      return event;
    }

    return {
      ...toolResultEvent,
      messageId: createResultMessageId(toolCallId),
    } as BaseEvent;
  };
}
