import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { ConnectionBar } from "./ConnectionBar";
import { FilterBar } from "./FilterBar";
import { EventList } from "./EventList";
import { EventDetail } from "./EventDetail";
import type { DebugEventEnvelope, ConnectionStatus, Filters } from "./types";

const vscode = acquireVsCodeApi();

const MAX_EVENTS = 10_000;

export function App() {
  const [events, setEvents] = useState<DebugEventEnvelope[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<DebugEventEnvelope | null>(
    null,
  );
  const [filters, setFilters] = useState<Filters>({
    eventTypes: new Set(),
    search: "",
    agentId: "",
    runId: "",
  });

  const firstTimestamp = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case "debug-event": {
          const envelope = msg.envelope as DebugEventEnvelope;
          setEvents((prev) => {
            const next = [...prev, envelope];
            if (next.length > MAX_EVENTS) {
              return next.slice(next.length - MAX_EVENTS);
            }
            return next;
          });
          if (firstTimestamp.current === null) {
            firstTimestamp.current = envelope.timestamp;
          }
          break;
        }
        case "connection-status":
          setConnectionStatus(msg.status);
          if (msg.status === "connected") setConnectionError(null);
          break;
        case "connection-error":
          setConnectionError(msg.error);
          break;
        case "clear":
          setEvents([]);
          setSelectedEvent(null);
          firstTimestamp.current = null;
          break;
      }
    };

    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleConnect = useCallback((runtimeUrl: string) => {
    setConnectionError(null);
    vscode.postMessage({ type: "connect", runtimeUrl });
  }, []);

  const handleDisconnect = useCallback(() => {
    vscode.postMessage({ type: "disconnect" });
  }, []);

  const handleClear = useCallback(() => {
    setEvents([]);
    setSelectedEvent(null);
    firstTimestamp.current = null;
    vscode.postMessage({ type: "clear" });
  }, []);

  const filteredEvents = useMemo(
    () =>
      events.filter((e) => {
        if (
          filters.eventTypes.size > 0 &&
          !filters.eventTypes.has(e.event.type)
        )
          return false;
        if (filters.agentId && e.agentId !== filters.agentId) return false;
        if (filters.runId && e.runId !== filters.runId) return false;
        if (filters.search) {
          const json = JSON.stringify(e).toLowerCase();
          if (!json.includes(filters.search.toLowerCase())) return false;
        }
        return true;
      }),
    [events, filters],
  );

  const seenAgentIds = useMemo(
    () => [...new Set(events.map((e) => e.agentId))],
    [events],
  );
  const seenRunIds = useMemo(
    () => [...new Set(events.map((e) => e.runId).filter(Boolean))],
    [events],
  );

  return (
    <div className="flex flex-col h-full">
      <ConnectionBar
        status={connectionStatus}
        error={connectionError}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onClear={handleClear}
      />
      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        seenAgentIds={seenAgentIds}
        seenRunIds={seenRunIds}
      />
      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <EventList
          events={filteredEvents}
          firstTimestamp={firstTimestamp.current}
          selectedEvent={selectedEvent}
          onSelectEvent={setSelectedEvent}
        />
        {selectedEvent && (
          <EventDetail
            envelope={selectedEvent}
            firstTimestamp={firstTimestamp.current}
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </div>
    </div>
  );
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
};
