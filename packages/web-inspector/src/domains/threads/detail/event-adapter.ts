import type { ThreadDebuggerEvent } from "../../../shared/thread-debugger/types.js";

export interface ApiAgentEvent {
  type: string;
  timestamp: string | number;
  payload: Record<string, unknown>;
  sourceIndex?: number;
  rawEvent?: ThreadDebuggerEvent;
}

export function adaptThreadEvents(
  events: ThreadDebuggerEvent[],
): ApiAgentEvent[] {
  return events.map((event, index) => {
    const { type, timestamp, payload, ...rest } = event;
    return {
      type: typeof type === "string" ? type : "UNKNOWN",
      timestamp:
        typeof timestamp === "string" || typeof timestamp === "number"
          ? timestamp
          : Date.now(),
      payload: payload ?? rest,
      sourceIndex: index + 1,
      rawEvent: event,
    };
  });
}

export function humanizeEventType(type: string): string {
  const words = type
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return "Event";
  const [first = "event", ...rest] = words;
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(
    " ",
  );
}

export function eventCategory(
  type: string,
): "message" | "tool" | "state" | "run" | "error" | "event" {
  if (type === "RUN_ERROR" || type === "ERROR") return "error";
  if (type.startsWith("TEXT_MESSAGE")) return "message";
  if (type.startsWith("TOOL_CALL")) return "tool";
  if (type.startsWith("STATE") || type.startsWith("MESSAGES")) return "state";
  if (type.startsWith("RUN_") || type.startsWith("STEP_")) return "run";
  return "event";
}

export function formatTimestamp(timestamp: string | number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const milliseconds = date.getMilliseconds().toString().padStart(3, "0");
  return `${date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })}.${milliseconds}`;
}
