"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { ChevronRight, X } from "lucide-react";

interface InspectorEvent {
  id: number;
  timestamp: number;
  type: string;
  payload: unknown;
}

const MAX_EVENTS = 200;

/**
 * Collapsible side panel showing the raw AG-UI event stream. Subscribes to
 * the active agent (langgraph or adk) and renders TEXT_MESSAGE_CONTENT,
 * TOOL_CALL_START, STATE_SNAPSHOT, STATE_DELTA, etc. as they arrive. Useful
 * for the demo because it shows the AG-UI protocol is the same no matter
 * which agent runtime is on the other end.
 */
export function EventInspector() {
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: config?.agentId });
  const [events, setEvents] = useState<InspectorEvent[]>([]);
  const [open, setOpen] = useState(false);
  const idRef = useRef(0);

  useEffect(() => {
    const sub = agent.subscribe({
      onEvent: ({ event }) => {
        idRef.current += 1;
        const next: InspectorEvent = {
          id: idRef.current,
          timestamp: Date.now(),
          type: (event as { type?: string }).type ?? "EVENT",
          payload: event,
        };
        setEvents((prev) => {
          const updated = [next, ...prev];
          return updated.length > MAX_EVENTS
            ? updated.slice(0, MAX_EVENTS)
            : updated;
        });
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Open AG-UI event inspector"
        style={{
          position: "fixed",
          top: "50%",
          right: 0,
          transform: "translateY(-50%)",
          width: 28,
          height: 64,
          background: "rgba(255, 255, 255, 0.5)",
          border: "2px solid #ffffff",
          borderRight: 0,
          borderRadius: "8px 0 0 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "var(--text-secondary)",
          zIndex: 60,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <ChevronRight
          style={{ width: 14, height: 14, transform: "rotate(180deg)" }}
        />
      </button>
    );
  }

  return (
    <aside
      aria-label="AG-UI event inspector"
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        bottom: 8,
        width: 380,
        background: "rgba(255, 255, 255, 0.65)",
        border: "2px solid #ffffff",
        borderRadius: 8,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0px 16px 24px -8px rgba(1, 5, 7, 0.12)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid #dbdbe5",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 400,
              color: "#57575b",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            AG-UI events
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#010507" }}>
            Live · {events.length}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setEvents([])}
            style={{
              padding: "4px 8px",
              border: "1px solid #dbdbe5",
              borderRadius: 4,
              background: "rgba(255,255,255,0.65)",
              fontSize: 11,
              fontWeight: 500,
              cursor: "pointer",
              color: "#57575b",
            }}
          >
            Clear
          </button>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close inspector"
            style={{
              width: 24,
              height: 24,
              border: 0,
              borderRadius: 4,
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#838389",
            }}
          >
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 8,
          fontFamily: "Spline Sans Mono, ui-monospace, monospace",
        }}
      >
        {events.length === 0 ? (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              fontSize: 11,
              color: "#838389",
              fontStyle: "italic",
            }}
          >
            Waiting for the agent to emit events…
          </div>
        ) : (
          events.map((evt) => <EventRow key={evt.id} event={evt} />)
        )}
      </div>
    </aside>
  );
}

const EVENT_COLORS: Record<string, string> = {
  RUN_STARTED: "#189370",
  RUN_FINISHED: "#189370",
  RUN_ERROR: "#fa5f67",
  TEXT_MESSAGE_START: "#bec2ff",
  TEXT_MESSAGE_CONTENT: "#bec2ff",
  TEXT_MESSAGE_END: "#bec2ff",
  TOOL_CALL_START: "#ffac4d",
  TOOL_CALL_ARGS: "#ffac4d",
  TOOL_CALL_END: "#ffac4d",
  TOOL_CALL_RESULT: "#ffac4d",
  STATE_SNAPSHOT: "#85ecce",
  STATE_DELTA: "#85ecce",
  CUSTOM: "#838389",
  RAW: "#838389",
};

function EventRow({ event }: { event: InspectorEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = EVENT_COLORS[event.type] ?? "#57575b";
  const time = new Date(event.timestamp);
  const timeStr = `${String(time.getHours()).padStart(2, "0")}:${String(
    time.getMinutes(),
  ).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}.${String(
    time.getMilliseconds(),
  ).padStart(3, "0")}`;

  const oneLine = oneLineSummary(event.payload);

  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      style={{
        padding: "5px 7px",
        marginBottom: 2,
        borderRadius: 4,
        background: "rgba(255,255,255,0.5)",
        cursor: "pointer",
        borderLeft: `3px solid ${color}`,
        fontSize: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#838389" }}>{timeStr}</span>
        <span style={{ color, fontWeight: 600 }}>{event.type}</span>
      </div>
      {oneLine && !expanded && (
        <div
          style={{
            marginTop: 2,
            color: "#57575b",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: 10,
          }}
        >
          {oneLine}
        </div>
      )}
      {expanded && (
        <pre
          style={{
            marginTop: 4,
            padding: 6,
            background: "#ffffff",
            borderRadius: 3,
            fontSize: 10,
            color: "#010507",
            maxHeight: 240,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

function oneLineSummary(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.delta === "string") return String(obj.delta).slice(0, 80);
  if (typeof obj.toolCallName === "string") return obj.toolCallName as string;
  if (typeof obj.name === "string") return obj.name as string;
  if (typeof obj.messageId === "string") return obj.messageId as string;
  return null;
}
