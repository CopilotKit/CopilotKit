export type EventCategory =
  | "lifecycle"
  | "error"
  | "text"
  | "tool"
  | "reasoning"
  | "state"
  | "activity"
  | "unknown";

const categoryColors: Record<
  EventCategory,
  { bg: string; text: string; border: string }
> = {
  lifecycle: {
    bg: "bg-purple-900/40",
    text: "text-purple-300",
    border: "border-l-purple-500",
  },
  error: {
    bg: "bg-red-900/40",
    text: "text-red-300",
    border: "border-l-red-500",
  },
  text: {
    bg: "bg-blue-900/40",
    text: "text-blue-300",
    border: "border-l-blue-500",
  },
  tool: {
    bg: "bg-orange-900/40",
    text: "text-orange-300",
    border: "border-l-orange-500",
  },
  reasoning: {
    bg: "bg-green-900/40",
    text: "text-green-300",
    border: "border-l-green-500",
  },
  state: {
    bg: "bg-teal-900/40",
    text: "text-teal-300",
    border: "border-l-teal-500",
  },
  activity: {
    bg: "bg-yellow-900/40",
    text: "text-yellow-300",
    border: "border-l-yellow-500",
  },
  unknown: {
    bg: "bg-gray-900/40",
    text: "text-gray-300",
    border: "border-l-gray-500",
  },
};

const eventTypeToCategory: Record<string, EventCategory> = {
  RUN_STARTED: "lifecycle",
  RUN_FINISHED: "lifecycle",
  RUN_ERROR: "error",
  TEXT_MESSAGE_START: "text",
  TEXT_MESSAGE_CONTENT: "text",
  TEXT_MESSAGE_END: "text",
  TEXT_MESSAGE_CHUNK: "text",
  TOOL_CALL_START: "tool",
  TOOL_CALL_ARGS: "tool",
  TOOL_CALL_END: "tool",
  TOOL_CALL_CHUNK: "tool",
  TOOL_CALL_RESULT: "tool",
  REASONING_START: "reasoning",
  REASONING_MESSAGE_START: "reasoning",
  REASONING_MESSAGE_CONTENT: "reasoning",
  REASONING_MESSAGE_END: "reasoning",
  REASONING_END: "reasoning",
  STATE_SNAPSHOT: "state",
  STATE_DELTA: "state",
  ACTIVITY_SNAPSHOT: "activity",
  ACTIVITY_DELTA: "activity",
  STEP_STARTED: "lifecycle",
  STEP_FINISHED: "lifecycle",
  MESSAGES_SNAPSHOT: "text",
  CUSTOM: "unknown",
};

export function getEventCategory(eventType: string): EventCategory {
  return eventTypeToCategory[eventType] ?? "unknown";
}

export function getEventColors(eventType: string) {
  return categoryColors[getEventCategory(eventType)];
}

export const allCategories: {
  category: EventCategory;
  label: string;
  eventTypes: string[];
}[] = [
  {
    category: "lifecycle",
    label: "Lifecycle",
    eventTypes: [
      "RUN_STARTED",
      "RUN_FINISHED",
      "STEP_STARTED",
      "STEP_FINISHED",
    ],
  },
  { category: "error", label: "Errors", eventTypes: ["RUN_ERROR"] },
  {
    category: "text",
    label: "Text Messages",
    eventTypes: [
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TEXT_MESSAGE_CHUNK",
      "MESSAGES_SNAPSHOT",
    ],
  },
  {
    category: "tool",
    label: "Tool Calls",
    eventTypes: [
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_CHUNK",
      "TOOL_CALL_RESULT",
    ],
  },
  {
    category: "reasoning",
    label: "Reasoning",
    eventTypes: [
      "REASONING_START",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
      "REASONING_END",
    ],
  },
  {
    category: "state",
    label: "State",
    eventTypes: ["STATE_SNAPSHOT", "STATE_DELTA"],
  },
  {
    category: "activity",
    label: "Activity/UI",
    eventTypes: ["ACTIVITY_SNAPSHOT", "ACTIVITY_DELTA"],
  },
  {
    category: "unknown",
    label: "Other",
    eventTypes: ["CUSTOM"],
  },
];
