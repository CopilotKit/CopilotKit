import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";
import React from "react";
import type { DebugEventEnvelope, Filters } from "../types";

// ---------------------------------------------------------------------------
// Mock acquireVsCodeApi before any component imports.
// Static imports are hoisted above statements, so App (which calls
// acquireVsCodeApi() at module scope) must be dynamically imported.
// ---------------------------------------------------------------------------
const postMessageMock = vi.fn();
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
  postMessage: postMessageMock,
  getState: () => null,
  setState: vi.fn(),
});

// ---------------------------------------------------------------------------
// Component imports — static for components that don't call
// acquireVsCodeApi at module scope; dynamic for App which does.
// ---------------------------------------------------------------------------
import { ConnectionBar } from "../ConnectionBar";
import { FilterBar } from "../FilterBar";
import { EventList } from "../EventList";
import { EventDetail } from "../EventDetail";

const { App } = await import("../App");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestEnvelope(
  overrides: Partial<DebugEventEnvelope> & {
    event?: Partial<DebugEventEnvelope["event"]>;
  } = {},
): DebugEventEnvelope {
  const { event: eventOverrides, ...rest } = overrides;
  return {
    timestamp: 1700000000000,
    agentId: "test-agent",
    threadId: "thread-1",
    runId: "run-1",
    event: { type: "RUN_STARTED", ...eventOverrides },
    ...rest,
  };
}

function simulateMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function defaultFilters(overrides: Partial<Filters> = {}): Filters {
  return {
    eventTypes: new Set<string>(),
    search: "",
    agentId: "",
    runId: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// ConnectionBar
// ---------------------------------------------------------------------------
describe("ConnectionBar", () => {
  const defaults = {
    status: "disconnected" as const,
    error: null as string | null,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onClear: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders URL input with default value "http://localhost:4000/api/copilotkit"', () => {
    render(<ConnectionBar {...defaults} />);
    const input = screen.getByPlaceholderText("Runtime URL");
    expect(input).toBeDefined();
    expect((input as HTMLInputElement).value).toBe(
      "http://localhost:4000/api/copilotkit",
    );
  });

  it("calls onConnect with the URL when Connect is clicked", () => {
    render(<ConnectionBar {...defaults} />);
    fireEvent.click(screen.getByText("Connect"));
    expect(defaults.onConnect).toHaveBeenCalledWith(
      "http://localhost:4000/api/copilotkit",
    );
  });

  it('shows "Disconnect" button when status is "connected"', () => {
    render(<ConnectionBar {...defaults} status="connected" />);
    expect(screen.getByText("Disconnect")).toBeDefined();
    expect(screen.queryByText("Connect")).toBeNull();
  });

  it("calls onClear when Clear button is clicked", () => {
    render(<ConnectionBar {...defaults} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(defaults.onClear).toHaveBeenCalledOnce();
  });

  it("disables URL input when status is not disconnected", () => {
    render(<ConnectionBar {...defaults} status="connecting" />);
    const input = screen.getByPlaceholderText("Runtime URL");
    expect((input as HTMLInputElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------
describe("FilterBar", () => {
  const onFiltersChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all category pills", () => {
    render(
      <FilterBar
        filters={defaultFilters()}
        onFiltersChange={onFiltersChange}
        seenAgentIds={[]}
        seenRunIds={[]}
      />,
    );
    expect(screen.getByText("Lifecycle")).toBeDefined();
    expect(screen.getByText("Errors")).toBeDefined();
    expect(screen.getByText("Text Messages")).toBeDefined();
    expect(screen.getByText("Tool Calls")).toBeDefined();
    expect(screen.getByText("Reasoning")).toBeDefined();
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText("Activity/UI")).toBeDefined();
  });

  it("toggles filter when a category pill is clicked", () => {
    render(
      <FilterBar
        filters={defaultFilters()}
        onFiltersChange={onFiltersChange}
        seenAgentIds={[]}
        seenRunIds={[]}
      />,
    );
    fireEvent.click(screen.getByText("Lifecycle"));
    expect(onFiltersChange).toHaveBeenCalledOnce();
    const updatedFilters = onFiltersChange.mock.calls[0][0] as Filters;
    expect(updatedFilters.eventTypes.has("RUN_STARTED")).toBe(true);
    expect(updatedFilters.eventTypes.has("RUN_FINISHED")).toBe(true);
  });

  it("updates search filter when typing in the search input", () => {
    render(
      <FilterBar
        filters={defaultFilters()}
        onFiltersChange={onFiltersChange}
        seenAgentIds={[]}
        seenRunIds={[]}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Search events..."), {
      target: { value: "TOOL" },
    });
    expect(onFiltersChange).toHaveBeenCalledOnce();
    const updatedFilters = onFiltersChange.mock.calls[0][0] as Filters;
    expect(updatedFilters.search).toBe("TOOL");
  });
});

// ---------------------------------------------------------------------------
// EventList
// ---------------------------------------------------------------------------
describe("EventList", () => {
  const onSelectEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows placeholder message when events array is empty", () => {
    render(
      <EventList
        events={[]}
        firstTimestamp={null}
        selectedEvent={null}
        onSelectEvent={onSelectEvent}
      />,
    );
    expect(
      screen.getByText("Connect to a runtime to start inspecting events"),
    ).toBeDefined();
  });

  it("renders events with correct type badges and timestamps", () => {
    const envelope = createTestEnvelope({
      timestamp: 1700000001500,
      event: { type: "TOOL_CALL_START", toolCallName: "search" },
    });
    render(
      <EventList
        events={[envelope]}
        firstTimestamp={1700000000000}
        selectedEvent={null}
        onSelectEvent={onSelectEvent}
      />,
    );
    expect(screen.getByText("TOOL_CALL_START")).toBeDefined();
    expect(screen.getByText("+1.500s")).toBeDefined();
  });

  it("calls onSelectEvent when an event row is clicked", () => {
    const envelope = createTestEnvelope();
    render(
      <EventList
        events={[envelope]}
        firstTimestamp={1700000000000}
        selectedEvent={null}
        onSelectEvent={onSelectEvent}
      />,
    );
    fireEvent.click(screen.getByText("RUN_STARTED"));
    expect(onSelectEvent).toHaveBeenCalledWith(envelope);
  });
});

// ---------------------------------------------------------------------------
// EventDetail
// ---------------------------------------------------------------------------
describe("EventDetail", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows event type badge, metadata, and JSON tree", () => {
    const envelope = createTestEnvelope({
      agentId: "my-agent",
      threadId: "t-42",
      runId: "r-99",
      event: { type: "TEXT_MESSAGE_CONTENT", delta: "hello" },
    });
    render(
      <EventDetail
        envelope={envelope}
        firstTimestamp={1700000000000}
        onClose={onClose}
      />,
    );
    // Type badge
    expect(screen.getByText("TEXT_MESSAGE_CONTENT")).toBeDefined();
    // Metadata
    expect(screen.getByText("my-agent")).toBeDefined();
    expect(screen.getByText("t-42")).toBeDefined();
    expect(screen.getByText("r-99")).toBeDefined();
  });

  it("calls onClose when the close button is clicked", () => {
    const envelope = createTestEnvelope();
    render(
      <EventDetail
        envelope={envelope}
        firstTimestamp={1700000000000}
        onClose={onClose}
      />,
    );
    // The close button contains the unicode "✕" character
    const closeBtn = screen.getByText("\u2715");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// App (integration)
// ---------------------------------------------------------------------------
describe("App", () => {
  beforeEach(() => {
    postMessageMock.mockClear();
  });

  it('sends "ready" message on mount', () => {
    render(<App />);
    expect(postMessageMock).toHaveBeenCalledWith({ type: "ready" });
  });

  it("adds event to list when receiving debug-event message", async () => {
    render(<App />);

    act(() => {
      simulateMessage({
        type: "debug-event",
        envelope: createTestEnvelope({
          event: { type: "TOOL_CALL_START", toolCallName: "search" },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("TOOL_CALL_START")).toBeDefined();
    });
  });

  it("updates connection status on connection-status message", async () => {
    render(<App />);

    act(() => {
      simulateMessage({
        type: "connection-status",
        status: "connected",
      });
    });

    await waitFor(() => {
      // When connected, the button text switches to "Disconnect"
      expect(screen.getByText("Disconnect")).toBeDefined();
    });
  });

  it("sends connect message when Connect is clicked", async () => {
    render(<App />);
    postMessageMock.mockClear();

    fireEvent.click(screen.getByText("Connect"));

    expect(postMessageMock).toHaveBeenCalledWith({
      type: "connect",
      runtimeUrl: "http://localhost:4000/api/copilotkit",
    });
  });
});
