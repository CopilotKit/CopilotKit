import React, { useRef, useEffect, useCallback } from "react";
import { getEventColors } from "./colors";
import type { DebugEventEnvelope } from "./types";

interface EventListProps {
  events: DebugEventEnvelope[];
  firstTimestamp: number | null;
  selectedEvent: DebugEventEnvelope | null;
  onSelectEvent: (event: DebugEventEnvelope) => void;
}

function formatTimestamp(ts: number, firstTs: number | null): string {
  if (firstTs === null) return "0.000s";
  const delta = (ts - firstTs) / 1000;
  return `+${delta.toFixed(3)}s`;
}

function summarizeEvent(event: {
  type: string;
  [key: string]: unknown;
}): string {
  const parts: string[] = [];
  if (event.messageId) parts.push(`msg:${event.messageId}`);
  if (event.toolCallId) parts.push(`tool:${event.toolCallId}`);
  if (event.toolCallName) parts.push(String(event.toolCallName));
  if (event.role) parts.push(String(event.role));
  if (typeof event.delta === "string") {
    const preview =
      event.delta.length > 60 ? event.delta.slice(0, 60) + "..." : event.delta;
    parts.push(`"${preview}"`);
  }
  if (event.message) parts.push(String(event.message));
  if (event.runId && event.type === "RUN_STARTED")
    parts.push(`run:${event.runId}`);
  return parts.join(" ");
}

export function EventList({
  events,
  firstTimestamp,
  selectedEvent,
  onSelectEvent,
}: EventListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const isSticky = useRef(true);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    isSticky.current = atBottom;
  }, []);

  useEffect(() => {
    if (isSticky.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto font-mono text-xs"
    >
      {events.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500">
          {firstTimestamp === null
            ? "Connect to a runtime to start inspecting events"
            : "No events match filters"}
        </div>
      ) : (
        events.map((envelope, i) => {
          const colors = getEventColors(envelope.event.type);
          const isSelected = selectedEvent === envelope;
          return (
            <div
              key={i}
              onClick={() => onSelectEvent(envelope)}
              className={`flex items-center gap-2 px-3 py-1 cursor-pointer border-l-2 ${colors.border} hover:bg-white/5 ${
                isSelected ? "bg-white/10" : ""
              }`}
            >
              <span className="text-gray-500 w-16 shrink-0 text-right">
                {formatTimestamp(envelope.timestamp, firstTimestamp)}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${colors.bg} ${colors.text}`}
              >
                {envelope.event.type}
              </span>
              <span className="text-gray-400 truncate">
                {summarizeEvent(envelope.event)}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
